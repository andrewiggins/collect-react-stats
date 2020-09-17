const createElementReturn = /return{\$\$typeof:([a-zA-z]+),type:([a-zA-z]+),key:([a-zA-z]+),ref:([a-zA-z]+),props:([a-zA-z]+),_owner:/;

// 6 occurrences of "return{$typeof:"
//
// 1. createElement
// 2. cloneAndReplaceKey
// 3. cloneElement
// 4. lazy
// 5 forwardRef
// 6. memo
//
// 2 additional occurrences of "$$typeof:"
//
// 1. createContext Consumer (actually, it's just context)
// 2. createContext Provider

/**
 * @param {string} scriptText
 */
export function containsReact(scriptText) {
	return scriptText.match(createElementReturn);
}

/**
 * @param {string} id
 * @param {string} scriptText
 * @returns {string}
 */
export function injectReactCounters(id, scriptText) {
	return scriptText.replace(
		createElementReturn,
		(substring, typeOfValue, typeValue, keyValue, refValue, propsValue) => {
			return (
				`window.__COLLECT_REACT_STATS__("${id}", Date.now(), 1);` + substring
			);
		}
	);
}
