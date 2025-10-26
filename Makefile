help:
	@echo "llm-sampling - LLM Sampler Demo"
	@echo ""
	@echo "Available targets:"
	@echo "  make setup                         Install requirements with Python 3.11"
	@echo "  make server MODEL=<model>          Start llama.cpp server with Docker (default: gemma-3-1b-it-Q4_K_M.gguf)"
	@echo "  make http-server                   Start simple HTTP server on port 8000"
	@echo "  make download-model MODEL=<model>  Download a GGUF model using Docker"
	@echo "  make generate-completions          Generate completions from prompts in in.json"
	@echo "  make help                          Show this help message"
	@echo ""
	@echo "Examples:"
	@echo "  make setup"
	@echo "  make server"
	@echo "  make server MODEL=gemma-3-1b-it-q4_k_m.gguf"
	@echo "  make download-model MODEL=DravenBlack/gemma-3-1b-it-q4_k_m-GGUF"
	@echo "  make generate-completions"

setup:
	python3.11 -m pip install -r requirements.txt

server:
	if [ ! -f "models/$$MODEL" ]; then \
		echo "Error: Model file 'models/$$MODEL' not found."; \
		echo "Download it first with: make download-model MODEL=$$MODEL"; \
		exit 1; \
	fi; \
	echo "Starting llama.cpp server with model: $$MODEL"; \
	echo "Server available at http://localhost:8080"; \
	echo "Press Ctrl+C to stop."; \
	docker run -p 8080:8080 -v ./models:/models ghcr.io/ggml-org/llama.cpp:server \
		-m /models/$$MODEL \
		-c 8192 \
		-np 16 \
		-cb

download-model:
	echo "Downloading model: $$MODEL"; \
	mkdir -p models; \
	hf download "$$MODEL" --local-dir ./models

generate-completions: prompts.json
	jq -r '.[]' prompts.json | parallel -n1 -j -- python ./src/generate_completions.py 127.0.0.1:8080 "{}" | jq -s '.' > web/probs.json

http-server:
	@echo "Starting HTTP server on http://127.0.0.1:8000/web/index.html"
	@echo "Press Ctrl+C to stop."
	python3.11 -m http.server 8000 --directory ./web
