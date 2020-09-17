import puppeteer from "puppeteer";

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
 * @returns {Promise<() => Promise<ReactStats>>}
 */
async function setupCollection(page) {
	await page.setRequestInterception(true);
	page.on("request", async (request) => {
		// TODO: see samples for modifying responses
		// https://github.com/puppeteer/puppeteer/issues/1229#issuecomment-357469434
		// https://github.com/puppeteer/puppeteer/issues/599#issuecomment-627366418
		// https://stackoverflow.com/questions/51596858/manually-change-response-url-during-puppeteer-request-interception
		await request.continue();
	});

	// TODO: Consider how to report data from page to nodejs
	// Perhaps exposeFunction: https://pptr.dev/#?product=Puppeteer&version=v5.3.0&show=api-pageexposefunctionname-puppeteerfunction
	// Perhaps page.on('console'): https://pptr.dev/#?product=Puppeteer&version=v5.3.0&show=api-event-console

	return async () => {
		return { vnodes: { total: 0 } };
	};
}

/**
 * @typedef ReactStats
 * @property {{ total: number }} vnodes
 *
 * @param {string} url
 * @returns {Promise<ReactStats>}
 */
export async function collectStats(url) {
	console.log("Launching browser...");
	const browser = await puppeteer.launch({
		headless: false,
		ignoreDefaultArgs: url ? ["about:blank"] : [],
		args: url ? [url] : [],
		defaultViewport: null,
	});

	const page = (await browser.pages())[0];
	if (page == null) {
		await exitWithError(
			browser,
			"Could not find page to setup stat collection on"
		);
	}

	const getStats = await setupCollection(page);
	console.log("Collecting stats on the first tab...");

	await await new Promise((resolve) => {
		browser.on("disconnected", () => resolve());
	});

	return getStats();
}
