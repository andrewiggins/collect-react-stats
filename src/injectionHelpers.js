var timeout;
var vnodes = [];

function reportVNode__ID__(vnode) {
	vnodes.push({
		$$typeof: getTypeOfName(vnode.$$typeof),
		type: getTypeName(vnode.type),
	});

	if (!timeout) {
		timeout = setTimeout(fileReport__ID__, 0);
	}
}

function fileReport__ID__() {
	// @ts-ignore - __COLLECT_REACT_STATS__ exists, trust me
	window.__COLLECT_REACT_STATS__("__ID__", Date.now(), vnodes);
	timeout = null;
	vnodes = [];
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
