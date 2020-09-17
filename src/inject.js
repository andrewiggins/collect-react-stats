import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const createElementReturn = /return{\$\$typeof:([a-zA-z]+),type:([a-zA-z]+),key:([a-zA-z]+),ref:([a-zA-z]+),props:([a-zA-z]+),_owner:/;

// @ts-ignore
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportJsTemplate = readFileSync(
	path.join(__dirname, "injectionHelpers.js"),
	"utf8"
);

// 6 occurrences of "return{$typeof:"
//
// 1. createElement
// 2. cloneAndReplaceKey
// 3. cloneElement
// 4. lazy
// 5. forwardRef
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
	const helpers = reportJsTemplate.replace(/__ID__/g, id) + "\n\n";
	const newBody = scriptText.replace(
		createElementReturn,
		(substring, $$typeofVar, typeVar, keyVar, refVar, propsVar) => {
			return (
				`reportVNode${id}({ $$typeof: ${$$typeofVar}, type: ${typeVar} });` +
				substring
			);
		}
	);

	return helpers + newBody;
}
