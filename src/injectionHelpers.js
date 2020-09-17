let timeout;

/** @type {Map<string, Map<number, number>>} */
let vNodeStats = new Map();
/** @type {Map<string, number>} */
let singleChildStats = new Map();

// TODO: Investigate a way to count text nodes...

function reportVNode__ID__($$typeof, type, key, ref, props) {
	const typeName = getTypeName(type);
	const isChildArray = Array.isArray(props.children);
	const childrenLength = isChildArray
		? props.children.length
		: props.children != null
		? 1
		: 0;

	// Category stats

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

	let categoryStats = vNodeStats.get(category);
	if (!categoryStats) {
		vNodeStats.set(category, (categoryStats = new Map()));
	}

	let prevCount = categoryStats.get(childrenLength) ?? 0;
	categoryStats.set(childrenLength, prevCount + 1);

	// Single child stats
	if (childrenLength == 1) {
		const singleChild = isChildArray ? props.children[0] : props.children;
		let singleChildType;
		if (
			typeof singleChild == "string" ||
			typeof singleChild == "number" ||
			typeof singleChild == "boolean" ||
			typeof singleChild == "bigint"
		) {
			singleChildType = "text";
		} else if (typeof singleChild == "function") {
			singleChildType = "function";
		} else if (singleChild.type != null) {
			singleChildType = getTypeName(singleChild);
		} else {
			singleChildType = "unknown";
		}

		singleChildStats.set(
			singleChildType,
			singleChildStats.get(singleChildType) ?? 0 + 1
		);
	}

	if (!timeout) {
		timeout = setTimeout(fileReport__ID__, 0);
	}
}

function fileReport__ID__() {
	const serializedVNodeStats = Array.from(
		vNodeStats.entries()
	).map(([key, value]) => [key, Array.from(value.entries())]);

	const serializedSingleChildStats = Array.from(singleChildStats.entries());

	// @ts-ignore - __COLLECT_REACT_STATS__ exists, trust me
	window.__COLLECT_REACT_STATS__(
		"__ID__",
		Date.now(),
		serializedVNodeStats,
		serializedSingleChildStats
	);

	timeout = null;
	vNodeStats = new Map();
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
		if (type.type) {
			return getTypeName(type.type);
		} else if (type.$$typeof) {
			return type.$$typeof.toString();
		} else {
			return type.toString();
		}
	} else {
		return type.toString();
	}
}
