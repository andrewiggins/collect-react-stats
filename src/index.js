import puppeteer from "puppeteer";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import { containsReact, injectReactCounters } from "./collectors.js";

let id = 0;

/**
 * @param {puppeteer.Browser} browser
 * @param {string} errorMessage
 */
async function exitWithError(browser, errorMessage) {
	await browser.close();
	throw new Error(errorMessage);
}

/**
 * @param {puppeteer.Page} page
 * @returns {Promise<() => Promise<ReactStats[]>>}
 */
async function setupCollection(page) {
	// TODO: Create a map of IDs to ReactStat objects. Each request that contains
	// React gets it's own ID that is used in the injected code to identify this
	// React instance. Pages should call the exposed function with their id and
	// their stats so we can add the stats to the right React instance.
	/** @type {Map<string, ReactStats>} */
	const statsMap = new Map();

	await page.setRequestInterception(true);

	const controller = new AbortController();
	page.on("close", () => {
		console.log("Closing page...");
		controller.abort();
	});

	page.exposeFunction("__COLLECT_REACT_STATS__", function (id, time, count) {
		const stats = statsMap.get(id);
		stats.logs.push({ time, vnodes: count });
		stats.vnodes.total += count;
	});

	page.on("request", async (request) => {
		if (request.resourceType() !== "script") {
			return request.continue();
		}

		const frameUrl = request.frame().url();
		const requestUrl = request.url();

		/** @type {import('node-fetch').RequestInit} */
		const requestInit = {
			method: request.method(),
			headers: request.headers(),
			body: request.postData(),
			follow: 20,
			signal: controller.signal,
		};

		let response;
		try {
			response = await fetch(requestUrl, requestInit);
		} catch (error) {
			if (error.name === "AbortError") {
				await request.abort();
				return;
			} else {
				throw error;
			}
		}

		let body = await response.text();
		if (containsReact(body)) {
			const statsId = id.toString();
			statsMap.set(statsId, {
				id: statsId,
				frameUrl,
				requestUrl,
				vnodes: { total: 0 },
				logs: [],
			});

			body = injectReactCounters(statsId, body);

			console.log(`React!! [${frameUrl}]: Fetched ${requestUrl}`);
		} else {
			// console.log(`[${frameUrl}]: Fetched ${requestUrl}`);
		}

		/** @type {Record<string, string>} */
		const headers = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});

		await request.respond({
			status: response.status,
			headers,
			body,
		});
	});

	// TODO: Consider how to report data from page to nodejs
	// Perhaps exposeFunction: https://pptr.dev/#?product=Puppeteer&version=v5.3.0&show=api-pageexposefunctionname-puppeteerfunction
	// Perhaps page.on('console'): https://pptr.dev/#?product=Puppeteer&version=v5.3.0&show=api-event-console

	return async () => Array.from(statsMap.values());
}

/**
 * @typedef ReactStats
 * @property {string} id
 * @property {string} frameUrl
 * @property {string} requestUrl
 * @property {{ total: number }} vnodes
 * @property {Array<{ time: number; vnodes: number }>} logs
 *
 * @param {string} url
 * @returns {Promise<ReactStats[]>}
 */
export async function collectStats(url) {
	console.log("Launching browser...");
	const browser = await puppeteer.launch({
		headless: false,
		defaultViewport: null,
	});

	const page = await browser.newPage();
	const pages = await browser.pages();
	for (let otherPage of pages) {
		if (otherPage !== page) {
			await otherPage.close();
		}
	}

	const getStats = await setupCollection(page);
	if (url) {
		page.goto(url);
	}

	console.log("Collecting stats on the second tab...");

	await new Promise((resolve) => {
		browser.on("disconnected", () => resolve());
	});

	return getStats();
}
