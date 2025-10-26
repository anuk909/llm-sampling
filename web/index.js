"use strict";

let prompts;
let max_tokens, vbar_width;
let currentPage = 1;
const itemsPerPage = 6;

const samplers = {
	temperature: (tokens, probs) => {
		if (tokens.length <= 1) return probs;
		let T = $("input#temperature-T").val();
		if ($("input#temperature-dyn").prop('checked')) {
			let range = Math.min(T, $("input#temperature-dyn-range").val());
			let expo = $("input#temperature-dyn-exponent").val();
			probs = normalize(tokens, probs);
			let max_entropy = -Math.log(1.0 / tokens.length), entropy = 0.0;
			for (let tok of tokens) {
				entropy -= probs[tok] * Math.log(probs[tok]);
			}
			T = (T - range) + 2 * range * Math.pow(entropy / max_entropy, expo);
		}
		T = 1.0 / T;
		for (let tok of tokens) {
			probs[tok] = Math.pow(probs[tok], T);
		}
		let sf = $("input#temperature-SS-SF").val();
		if ($("input#temperature-SS").prop('checked') && sf > 0) {
			for (let tok of tokens) {
				probs[tok] = probs[tokens[0]] * Math.exp(
					-sf * Math.pow(Math.log(probs[tok] / probs[tokens[0]]), 2.0)
				);
			}
		}
		return probs;
	},
	top_k: (tokens, probs) => {
		let k = $("input#top_k").closest('div.alert').find('input[type="range"]').val();
		let chart = $("input#top_k").closest('div.alert').find('div.chart').empty()[0], bar;
		let i = 0;
		let cols = max_tokens;
		for (let tok of tokens) {
			bar = document.createElement('div');
			let p = probs[tok] / probs[tokens[0]];
			bar.setAttribute('style', vbar_width
				+ 'height: calc(' + (100.0 * p).toFixed(2)
				+ '% + 1px); top: calc(' + (100.0 * (1.0 - p)).toFixed(2)
				+ '% - 1px); left: ' + (100.0 * i / cols).toFixed(2) + '%;');
			bar.classList.add('vbar');
			chart.appendChild(bar);
			if (++i > k) {
				delete probs[tok];
			}
		}
		bar = document.createElement('div');
		bar.setAttribute('style', 'height: 100%; top: 0; left: '
			+ (100.0 * k / 50).toFixed(2) + '%;');
		bar.classList.add('cutoff');
		chart.appendChild(bar);
		return probs;
	},
	top_p: (tokens, probs) => {
		let p = $("input#top_p").closest('div.alert').find('input[type="range"]').val();
		let chart = $("input#top_p").closest('div.alert').find('div.chart').empty()[0], bar;
		let i = 0, P = 0.0;
		probs = normalize(tokens, probs);
		for (let tok of tokens) {
			bar = document.createElement('div');
			bar.classList.add('vbar');
			bar.setAttribute('style', vbar_width
				+ 'left: ' + (100 * i / max_tokens).toFixed(2)
				+ '%; top: calc(' + (100.0 * P).toFixed(2)
				+ '% - 1px); height: calc(' + (100.0 * probs[tok]).toFixed(2) + '% + 1px);');
			chart.appendChild(bar);
			bar = document.createElement('div');
			bar.classList.add('vbar');
			bar.classList.add('vbar_top_p');
			bar.setAttribute('style', vbar_width
				+ 'left: ' + (100 * i / max_tokens).toFixed(2)
				+ '%; top: calc(' + (100.0 * (P + probs[tok])).toFixed(2)
				+ '% - 1px); height: calc(' + (100.0 * (1.0 - P - probs[tok])).toFixed(2) + '% + 1px);');
			chart.appendChild(bar);
			P += probs[tok];
			i += 1;
			if (P - probs[tok] > p) {
				delete probs[tok];
			}
		}
		bar = document.createElement('div');
		bar.setAttribute('style', 'width: 100%; left: 0; height: '
			+ (100.0 * (1.0 - p)).toFixed(2) + '%; top: '
			+ (100.0 * p).toFixed(2) + '%;');
		bar.classList.add('cutoff');
		chart.appendChild(bar);
		return probs;
	},
	min_p: (tokens, probs) => {
		if (tokens.length === 0) return probs;
		let p = $("input#min_p").closest('div.alert').find('input[type="range"]').val();
		let chart = $("input#min_p").closest('div.alert').find('div.chart').empty()[0], bar;
		let cols = max_tokens;
		let cutoff = probs[tokens[0]] * p;
		let i = 0;
		for (let tok of tokens) {
			bar = document.createElement('div');
			let p = probs[tok] / probs[tokens[0]];
			bar.setAttribute('style', vbar_width
				+ 'height: calc(' + (100.0 * p).toFixed(2)
				+ '% + 1px); top: calc(' + (100.0 * (1.0 - p)).toFixed(2)
				+ '% - 1px); left: ' + (100.0 * i / cols).toFixed(2) + '%;');
			bar.classList.add('vbar');
			chart.appendChild(bar);
			if (probs[tok] < cutoff) {
				delete probs[tok];
			}
			++i;
		}
		bar = document.createElement('div');
		bar.setAttribute('style', 'width: 100%; left: 0; height: '
			+ (100.0 * p).toFixed(2) + '%; top: '
			+ (100.0 * (1.0 - p)).toFixed(2) + '%;');
		bar.classList.add('cutoff');
		chart.appendChild(bar);
		return probs;
	},

};

const normalize = (tokens, probs) => {
	let sum = 0.0;
	for (let t of tokens) {
		sum += probs[t];
	}
	for (let t of tokens) {
		probs[t] /= sum;
	}
	return probs;
};

const update_prompt = () => {
	update_sample();
};

const update_sample = () => {
	let i = window.currentPromptIndex !== undefined ? window.currentPromptIndex : 0;
	let sum = 0.0;
	let probs = JSON.parse(JSON.stringify(prompts[i][1]));
	$("div#samplers div.alert:has(h3 > input:checked)").each((idx, el) => {
		let sname = $(el).find('input:checked').prop('id');
		probs = samplers[sname](Object.keys(probs), probs);
	});
	let tokens = Object.keys(probs);
	probs = normalize(tokens, probs);

	// Calculate pagination
	const totalItems = tokens.length;
	const totalPages = Math.ceil(totalItems / itemsPerPage);
	currentPage = Math.min(currentPage, totalPages || 1);

	const startIdx = (currentPage - 1) * itemsPerPage;
	const endIdx = Math.min(startIdx + itemsPerPage, totalItems);
	const pageTokens = tokens.slice(startIdx, endIdx);

	// Populate table rows
	let tbody = $("div#retained tbody").empty()[0];
	let pcf = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 3, minimumFractionDigits: 3 });
	for (let t of pageTokens) {
		let tr = document.createElement('tr');
		let td = document.createElement('td');
		tbody.appendChild(tr);
		tr.appendChild(td);
		td.textContent = t;
		td = document.createElement('td');
		tr.appendChild(td);
		td.textContent = pcf.format(probs[t]);
		td = document.createElement('td');
		tr.appendChild(td);
		let div = document.createElement('div');
		td.appendChild(div);
		td.classList.add('align-middle');
		div.classList.add('progress');
		let pbar = document.createElement('div');
		div.appendChild(pbar);
		pbar.classList.add('progress-bar');
		pbar.classList.add('bg-primary');
		pbar.setAttribute('style', 'width: ' + (100.0 * probs[t] / probs[tokens[0]]).toFixed(2) + '%;')
	}

	// Update pagination
	updatePagination(totalPages);
};

const updatePagination = (totalPages) => {
	let paginationEl = $("#pagination").empty();

	if (totalPages <= 1) {
		return;
	}

	// Previous button
	let prevLi = document.createElement('li');
	prevLi.className = 'page-item' + (currentPage === 1 ? ' disabled' : '');
	let prevA = document.createElement('a');
	prevA.className = 'page-link';
	prevA.href = '#';
	prevA.textContent = 'Previous';
	prevA.addEventListener('click', (e) => {
		e.preventDefault();
		if (currentPage > 1) {
			currentPage--;
			update_sample();
		}
	});
	prevLi.appendChild(prevA);
	paginationEl.append(prevLi);

	// Page numbers
	for (let i = 1; i <= totalPages; i++) {
		let li = document.createElement('li');
		li.className = 'page-item' + (i === currentPage ? ' active' : '');
		let a = document.createElement('a');
		a.className = 'page-link';
		a.href = '#';
		a.textContent = i;
		a.addEventListener('click', (e) => {
			e.preventDefault();
			currentPage = i;
			update_sample();
		});
		li.appendChild(a);
		paginationEl.append(li);
	}

	// Next button
	let nextLi = document.createElement('li');
	nextLi.className = 'page-item' + (currentPage === totalPages ? ' disabled' : '');
	let nextA = document.createElement('a');
	nextA.className = 'page-link';
	nextA.href = '#';
	nextA.textContent = 'Next';
	nextA.addEventListener('click', (e) => {
		e.preventDefault();
		if (currentPage < totalPages) {
			currentPage++;
			update_sample();
		}
	});
	nextLi.appendChild(nextA);
	paginationEl.append(nextLi);
};

$(() => {
	$.get("./probs.json", data => {
		prompts = data;
		window.currentPromptIndex = 0;
		let promptSelect = $("#promptSelect");
		for (let i in prompts) {
			let option = document.createElement('option');
			option.value = i;
			option.textContent = prompts[i][0] + ' _____';
			promptSelect.append(option);
		}
		promptSelect.on('change', (e) => {
			window.currentPromptIndex = $(e.target).val();
			update_prompt();
		});
		promptSelect.val(0);
		update_sample();
	});

	let types = ["range", "text"];
	for (let i in types) {
		$("div#samplers input[type='" + types[i] + "']").on('input', e => {
			let v = $(e.target).val();
			$(e.target).closest('div.row').find('input[type="' + types[1 - i] + '"]').val(v);
		});
	}

	max_tokens = $("input#top_k").closest('div.alert').find('input[type="range"]').attr('max');
	vbar_width = 'width: calc(' + (100.0 / max_tokens).toFixed(2) + '% - 1px);';

	$("[data-bs-toggle='tooltip']").each((i, e) => new bootstrap.Tooltip(e));
	$("div#samplers input").on('input', update_sample);
	$("div#samplers").sortable({ update: update_sample });
});
