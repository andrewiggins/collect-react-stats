/**
 * @typedef ReactStats
 * @property {{ total: number }} vnodes
 *
 * @param {string} url
 * @returns {ReactStats}
 */
export function collectStats(url) {
	console.log("Collecting stats...");
	return { vnodes: { total: 0 } };
}
