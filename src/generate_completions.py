import asyncio
import aiohttp
import sys
import json
import re
from collections import defaultdict
import math
from typing import Any
from tqdm import tqdm

TOP_K = 50
N_PROBS = 1000
PARALLEL_REQUESTS = 16
TIMEOUT = 300
API_PATH = "/completion"


async def make_request(
    session: aiohttp.ClientSession, url: str, payload: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Make an async HTTP POST request to the LLM server.

    Args:
        session: The aiohttp client session.
        url: The server endpoint URL.
        payload: The JSON payload to send.

    Returns:
        The JSON response from the server, or None if the request fails.
    """
    try:
        async with session.post(
            url, json=payload, timeout=aiohttp.ClientTimeout(total=TIMEOUT)
        ) as response:
            response.raise_for_status()
            return await response.json()
    except Exception as e:
        print(f"Warning: Request failed: {type(e).__name__}: {e}", file=sys.stderr)
        return None


def parse_probabilities(ans_json: dict[str, Any]) -> list[tuple[str, float]]:
    """
    Extract token probabilities from the LLM server response.

    Args:
        ans_json: The JSON response from the LLM server containing completion probabilities.

    Returns:
        A list of tuples (token_string, probability) sorted by descending probability.

    Raises:
        ValueError: If the expected logprob format is not found in the response.
    """
    completion_item = ans_json.get("completion_probabilities", [{}])[0]
    raw_tokens_list = completion_item.get("top_logprobs") or completion_item.get(
        "logprobs"
    )
    if not isinstance(raw_tokens_list, list) and isinstance(completion_item, list):
        raw_tokens_list = completion_item
    if (
        raw_tokens_list
        and "token" in raw_tokens_list[0]
        and "logprob" in raw_tokens_list[0]
    ):
        probs = []
        for token_data in raw_tokens_list:
            logprob = token_data.get("logprob")
            if logprob is not None and math.isfinite(logprob):
                prob = math.exp(logprob)
                probs.append((token_data.get("token", ""), prob))
        return probs
    raise ValueError("Logprob format not found in response.")


async def process_token(
    session: aiohttp.ClientSession,
    full_prompt: str,
    token_str: str,
    prob: float,
    url: str,
) -> tuple[str, float] | None:
    """
    Process a single token by requesting completion and extracting the full word.

    Args:
        session: The aiohttp client session.
        full_prompt: The original prompt text.
        token_str: The token/partial word to complete.
        prob: The probability of this token.
        url: The server endpoint URL.

    Returns:
        A tuple (word, probability) if a valid word is found, or None if the token
        does not produce a valid word.
    """
    payload = {
        "prompt": full_prompt + token_str,
        "cache_prompt": True,
        "n_predict": 5,
        "samplers": ["top_k"],
        "top_k": 1,
    }
    ret_json = await make_request(session, url, payload)
    if ret_json is None:
        return None
    completion = ret_json.get("content", "")
    word = (token_str + completion).strip()

    # Match letters and numbers (unicode-aware like PHP's \pL and \pN)
    match = re.match(r"^([\w]+)", word, re.UNICODE)
    if match:
        return match.group(1), prob
    return None


async def main():
    """
    Main entry point. Fetches up to TOP_K unique word completions from the LLM.

    The script expects two command-line arguments:
    1. server-addr:port - The address and port of the LLM server
    2. prompt - The initial prompt to send to the model

    Continuously fetches token predictions and completes them concurrently until
    TOP_K unique words are found. Tokens that don't produce valid words are skipped.

    Outputs JSON with the prompt and a dictionary of completed words with their probabilities.
    """
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <server-addr:port> <prompt>", file=sys.stderr)
        sys.exit(1)

    server_addr, prompt = sys.argv[1], sys.argv[2]
    url = f"http://{server_addr}{API_PATH}"
    print(f"Querying: {prompt}", file=sys.stderr)

    word_probabilities = defaultdict(float)
    semaphore = asyncio.Semaphore(PARALLEL_REQUESTS)
    token_queue: list[tuple[str, float]] = []

    async with aiohttp.ClientSession() as session:
        # Fetch initial token probabilities
        initial_payload = {
            "prompt": prompt,
            "cache_prompt": True,
            "n_predict": 1,
            "n_probs": N_PROBS,
            "top_k": N_PROBS,
        }
        ans_json = await make_request(session, url, initial_payload)
        if ans_json is None:
            print("Error: Initial request failed.", file=sys.stderr)
            sys.exit(1)

        token_queue = parse_probabilities(ans_json)
        print(
            f"Fetched {len(token_queue)} candidate tokens, processing until {TOP_K} unique words found...",
            file=sys.stderr,
        )

        pbar = tqdm(desc="Words found")

        async def limited_process_token(tp: tuple[str, float]):
            async with semaphore:
                return await process_token(session, prompt, tp[0], tp[1], url)

        # Process tokens until we have TOP_K unique words
        while len(word_probabilities) < TOP_K and token_queue:
            # Determine how many tokens to process in this batch
            remaining_needed = TOP_K - len(word_probabilities)
            batch_size = min(PARALLEL_REQUESTS, len(token_queue), remaining_needed * 2)

            # Take tokens from queue
            batch = [token_queue.pop(0) for _ in range(batch_size)]

            # Process batch concurrently
            tasks = [limited_process_token(tp) for tp in batch]
            results = await asyncio.gather(*tasks)

            # Add valid results to word_probabilities
            for result in results:
                if result:
                    word, prob = result
                    word_probabilities[word] += prob
                    pbar.update(1)

        pbar.close()
        print("\nFinished processing.", file=sys.stderr)

    sorted_results = sorted(
        word_probabilities.items(), key=lambda x: x[1], reverse=True
    )
    output_data = [prompt, dict(sorted_results)]
    print(json.dumps(output_data, indent=2))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nProcess interrupted.", file=sys.stderr)
        sys.exit(1)
