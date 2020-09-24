let timeout,
	start,
	total = 0;

/** @type {Map<string, Map<number, number>>} */
let vNodeStats = new Map();
/** @type {Map<string, number>} */
let singleChildStats = new Map();
/** @type {Map<string, number>} */
let domPropStats = new Map();

// TODO: Investigate a way to count text nodes...

function reportVNode__ID__($$typeof, type, key, ref, props) {
	const isChildArray = Array.isArray(props.children);
	const childrenLength = isChildArray
		? props.children.length
		: "children" in props
		? 1
		: 0;

	// Total count
	total += 1;

	// Category stats
	let category = getVNodeCategory(type);
	let categoryStats = vNodeStats.get(category);
	if (!categoryStats) {
		vNodeStats.set(category, (categoryStats = new Map()));
	}

	let prevCount = categoryStats.get(childrenLength) ?? 0;
	categoryStats.set(childrenLength, prevCount + 1);

	// Single child stats
	if (childrenLength == 1) {
		const child = isChildArray ? props.children[0] : props.children;
		const childCategory = getChildCategory(child);

		const prevCount = singleChildStats.get(childCategory) ?? 0;
		singleChildStats.set(childCategory, prevCount + 1);
	}

	// Prop stats
	if (category == "dom") {
		const propKeys = Object.keys(props);
		for (const key of propKeys) {
			domPropStats.set(key, (domPropStats.get(key) ?? 0) + 1);
		}
	}

	if (!timeout) {
		start = Date.now();
		timeout = setTimeout(fileReport__ID__, 0);
	}
}

function fileReport__ID__() {
	const serializedVNodeStats = Array.from(
		vNodeStats.entries()
	).map(([key, value]) => [key, Array.from(value.entries())]);

	let end = Date.now();
	let duration = end - start;
	let rate = total / duration;
	let timing = {
		start,
		end,
		total,
		rate,
	};

	// @ts-ignore - __COLLECT_REACT_STATS__ exists, trust me
	window.__COLLECT_REACT_STATS__(
		"__ID__",
		timing,
		serializedVNodeStats,
		Array.from(singleChildStats.entries()),
		Array.from(domPropStats.entries())
	);

	total = 0;
	start = null;
	timeout = null;
	vNodeStats = new Map();
	singleChildStats = new Map();
	domPropStats = new Map();
}

function getVNodeCategory(type) {
	if (type == null) {
		return "null";
	} else if (typeof type == "string") {
		return "dom";
	} else if (typeof type == "function") {
		return type.prototype.render ? "class" : "function";
	} else if (typeof type == "object") {
		if (type.$$typeof !== Symbol.for("react.element")) {
			return type.$$typeof.toString();
		} else if (type.type) {
			return getVNodeCategory(type.type);
		} else {
			return type.toString();
		}
	} else {
		return type.toString();
	}
}

function getChildCategory(child) {
	if (child == null || typeof child == "boolean") {
		return "null";
	} else if (
		typeof child == "string" ||
		typeof child == "number" ||
		typeof child == "bigint"
	) {
		return "text";
	} else if (typeof child == "function") {
		return "function";
	} else if (typeof child == "object") {
		return getVNodeCategory(child.type);
	} else {
		return "unknown";
	}
}
