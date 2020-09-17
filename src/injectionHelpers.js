let timeout;

/** @type {Map<string, Map<number, number>>} */
let stats = new Map();

// Categories Preact collects:
// 1. Class Component
// 2. Function Component
// 3. Fragment
// 4. forwardRef
// 5. memo
// 6. Suspense
// 7. DOM Element
// 8. Text

function reportVNode__ID__($$typeof, type, key, ref, props) {
	const typeName = getTypeName(type);
	const childrenLength = props.children?.length ?? 0;

	let category;
	if (typeof type == "string") {
		category = "dom";
	} else if (typeof type == "function") {
		if (type.prototype.render) {
			category = "class";
		} else {
			category = "function";
		}
	} else {
		category = typeName;
	}

	let categoryStats = stats.get(category);
	if (!categoryStats) {
		stats.set(category, (categoryStats = new Map()));
	}

	let prevCount = categoryStats.get(childrenLength) ?? 0;
	categoryStats.set(childrenLength, prevCount + 1);

	if (!timeout) {
		timeout = setTimeout(fileReport__ID__, 0);
	}
}

function fileReport__ID__() {
	const serializedStats = Array.from(stats.entries()).map(([key, value]) => [
		key,
		Array.from(value.entries()),
	]);

	// @ts-ignore - __COLLECT_REACT_STATS__ exists, trust me
	window.__COLLECT_REACT_STATS__("__ID__", Date.now(), serializedStats);
	timeout = null;
	stats = new Map();
}

function getTypeOfName($$typeof) {
	return $$typeof.toString();
}

function getTypeName(type) {
	if (type == null) {
		return "null";
	} else if (typeof type == "function") {
		return type.name;
	} else if (typeof type == "object") {
		if (type.$$typeof) {
			return type.$$typeof.toString();
		} else {
			return type.toString();
		}
	} else {
		return type.toString();
	}
}
