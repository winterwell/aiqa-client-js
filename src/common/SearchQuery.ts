// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * Gmail-style search query parser and builder. Supports AND/OR operators and field:value syntax.
 * Used for filtering entities in both PostgreSQL and Elasticsearch queries.
 */

import { assert, assMatch } from './utils/assert.js';
import { is } from './utils/miscutils.js';

// Simple lodash-like utilities
const _ = {
	isString: (value: any): value is string => typeof value === 'string',
	find: <T>(array: T[], predicate: (item: T) => boolean): T | undefined => {
		return array.find(predicate);
	},
	eq: (a: any, b: any): boolean => {
		return JSON.stringify(a) === JSON.stringify(b);
	}
};

/**
 * Parses and manipulates Gmail-style search queries. Supports AND/OR operators and field:value syntax.
 * Example: new SearchQuery("apples OR oranges") or SearchQuery.setProp(sq, "lang", "en")
 */
class SearchQuery {

	/** @type {!String} */
	query: string;

	/**
	 * e.g. ["OR", "a", ["AND", "b", {"near", "c"}]]
	 */
	tree?: any[];

	options?: any;

	// Static constants
	static readonly AND = "AND";
	static readonly OR = "OR";
	static readonly NOT = "NOT";
	static readonly REMOVE = "RM";
	static readonly GENERAL_OPTIONS = {
		OR: ["OR", ","],
		AND: ["AND"],
		NOT: ["-"]
	};

	// Static methods
	static _init: (sq: SearchQuery) => void;
	static parse: (sq: SearchQuery) => void;
	static prop: (sq: SearchQuery, propName: string) => string | null;
	static setProp: (sq: SearchQuery | string | null, propName: string, propValue?: string | boolean | null) => SearchQuery;
	static setPropOr: (sq: SearchQuery | null | undefined, propName: string, propValues: string[]) => SearchQuery;
	static or: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null) => SearchQuery | null;
	static op: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null, op: string) => SearchQuery | null;
	static and: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null) => SearchQuery | null;
	static remove: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null) => SearchQuery | null;
	static str: (sq: SearchQuery | null | undefined) => string;
	/** Get value for key from a query string, or null if not present. */
	static propFromString: (queryString: string, key: string) => string | null;
	/** Set or remove key:value in a query string. Returns new query string. If value is null/undefined/empty, removes any existing key:value for that key. */
	static setPropInString: (queryString: string, key: string, value?: string | boolean | null) => string;

	/**
	 * 
	 * @param {?String|SearchQuery} query 
	 * @param {?Object} options 
	 */
	constructor(query?: string | SearchQuery | null, options?: any) {
		// DataClass._init(this, base); not needed??
		this.query = (query as any)?.query || (query as string) || "";
		// NB: unwrap if the input is a SearchQuery
		if ((this.query as any).query) this.query = (this.query as any).query;
		this.options = Object.assign({}, SearchQuery.GENERAL_OPTIONS, options, (this.query as any).options);
		SearchQuery.parse(this);
	}

} // ./SearchQuery


SearchQuery._init = (sq: SearchQuery) => {
	if (sq.tree) return;
	SearchQuery.parse(sq);
}


/**
 * Tokenize query string: "(", ")", "AND", "OR", or term (field:value / word).
 * Quoted values are merged so key:"val ue" becomes one term.
 */
function tokenize(query: string): string[] {
	const tokens: string[] = [];
	const segments = query.trim().split(/\s+/).filter(Boolean);
	let i = 0;
	while (i < segments.length) {
		let seg = segments[i];
		// Emit leading '(' as separate tokens
		while (seg.startsWith('(')) {
			tokens.push('(');
			seg = seg.slice(1);
		}
		// Emit trailing ')' as separate tokens
		let trailingParens = 0;
		while (seg.endsWith(')')) {
			trailingParens++;
			seg = seg.slice(0, -1);
		}
		// Check for quoted value: key:"...
		const quotedMatch = seg.match(/^([a-zA-Z_0-9.]+):"(.*)$/);
		if (quotedMatch) {
			const key = quotedMatch[1];
			let value = quotedMatch[2];
			if (!value.endsWith('"')) {
				i++;
				while (i < segments.length) {
					const next = segments[i];
					value += ' ' + next.replace(/\)+$/, '');
					if (next.endsWith('"')) break;
					i++;
				}
			}
			if (value.startsWith('"')) value = value.slice(1);
			if (value.endsWith('"')) value = value.slice(0, -1);
			tokens.push(key + ':' + value);
		} else if (seg) {
			tokens.push(seg);
		}
		while (trailingParens--) tokens.push(')');
		i++;
	}
	return tokens;
}

/**
 * Parse with AND/OR precedence and parentheses. OR has lowest precedence.
 * Returns tree: [op, ...operands] or single term {key:value} / string.
 */
function parseExpression(tokens: string[]): any {
	function parsePrimary(): any {
		if (tokens.length === 0) return null;
		const t = tokens[0];
		if (t === '(') {
			tokens.shift();
			const expr = parseOr();
			if (tokens[0] === ')') tokens.shift();
			return expr;
		}
		return parseTerm();
	}
	function parseTerm(): any {
		if (tokens.length === 0) return null;
		const t = tokens.shift()!;
		const kv = t.match(/^([a-zA-Z_0-9.]+):(.+)$/);
		if (kv) {
			const value = kv[2];
			return { [kv[1]]: value };
		}
		return t;
	}
	function parseAnd(): any {
		let left = parsePrimary();
		// Consume explicit AND or implicit AND (adjacent terms)
		while (tokens.length > 0 && tokens[0] !== ')' && tokens[0] !== SearchQuery.OR) {
			if (tokens[0] === SearchQuery.AND) tokens.shift();
			const right = parsePrimary();
			if (right != null) left = [SearchQuery.AND, left, right];
		}
		return left;
	}
	function parseOr(): any {
		let left = parseAnd();
		while (tokens.length > 0 && tokens[0] === SearchQuery.OR) {
			tokens.shift();
			const right = parseAnd();
			if (right != null) left = [SearchQuery.OR, left, right];
		}
		return left;
	}
	return parseOr();
}

SearchQuery.parse = (sq: SearchQuery) => {
	const tokens = tokenize(sq.query);
	if (tokens.length === 0) {
		sq.tree = [SearchQuery.AND];
		return;
	}
	let tree = parseExpression(tokens);
	// Normalise single term to [AND, term] so tree is always [op, ...operands]
	if (tree != null && typeof tree === 'object' && !Array.isArray(tree)) {
		sq.tree = [SearchQuery.AND, tree];
	} else if (tree != null && typeof tree === 'string') {
		sq.tree = [SearchQuery.AND, tree];
	} else if (Array.isArray(tree) && tree.length > 0) {
		sq.tree = tree;
	} else {
		sq.tree = [SearchQuery.AND];
	}
}


/** Find first occurrence of propName in tree (recursive). */
function findPropInTree(tree: any, propName: string): string | null {
	if (tree && typeof tree === 'object' && !Array.isArray(tree) && propName in tree) {
		return tree[propName];
	}
	if (Array.isArray(tree)) {
		for (let i = 1; i < tree.length; i++) {
			const v = findPropInTree(tree[i], propName);
			if (v != null) return v;
		}
	}
	return null;
}

/**
 * Return the value for propName if it appears in the query (first occurrence).
 * Searches the whole tree, not just top-level.
 */
SearchQuery.prop = (sq: SearchQuery, propName: string): string | null => {
	SearchQuery._init(sq);
	return findPropInTree(sq.tree, propName);
}


/**
 * Set a top-level prop, e.g. vert:foo
 * @param {?SearchQuery|string} sq
 * @param {!String} propName 
 * @param {?String|Boolean} propValue If unset (null,undefined, or "" -- but not false or 0!), clear the prop. The caller is responsible for converting non-strings to strings - apart from boolean which thie method will handle, 'cos we're nice like that.
 * @returns {SearchQuery} a NEW SearchQuery. Use .query to get the string
 */
SearchQuery.setProp = (sq: SearchQuery | string | null, propName: string, propValue?: string | boolean | null): SearchQuery => {	
	assMatch(propName, String);
	if (_.isString(sq)) {
		sq = new SearchQuery(sq);
	}
	// boolean has gotchas, so lets handle it. But not number, as the caller should decide on e.g. rounding
	if (typeof(propValue) === "boolean") propValue = ""+propValue; // true/false
	assMatch(propValue, "?String");
	assMatch(propName, String, "searchquery.js - "+propName+" "+propValue);
	let newq = "";
	// remove the old
	if (sq) {
		assMatch(sq, SearchQuery);
		newq = snipProp(sq, propName);
	}
	// unset? (but do allow prop:false and x:0)
	if (propValue===null || propValue===undefined || propValue==="") {
		if ( ! newq) {
			// console.warn("SearchQuery.js null + null!",sq,propName,propValue);
			return new SearchQuery();
		}
		// already removed the old
	} else {
		// quote the value?
		const propValueStr = String(propValue);
		let qpropValue = propValueStr.indexOf(" ") === -1? propValueStr : '"'+propValueStr+'"';
		newq = (newq? newq+" AND " : "") + propName+":"+qpropValue;
	}
	// Collapse duplicate ANDs
	newq = newq.replace(/\s+AND(\s+AND)+\s+/g, " AND ");
	// Trim leading, trailing, empty ANDs
	newq = newq.replace(/^\s*(AND\s+)+/g, "");
	newq = newq.replace(/(\s+AND)+\s*$/g, "");
	newq = newq.replace(/^\s*AND\s*$/, "");

	// done
	return new SearchQuery(newq.trim());
}


/** Remove all key:value nodes with propName from tree (recursive). Flattens single-child AND/OR. */
function treeWithoutProp(tree: any, propName: string): any {
	if (tree && typeof tree === 'object' && !Array.isArray(tree) && propName in tree) {
		return null; // drop this node
	}
	if (typeof tree === 'string') return tree;
	if (!Array.isArray(tree)) return tree;
	const op = tree[0];
	const filtered = tree.slice(1)
		.map((bit: any) => treeWithoutProp(bit, propName))
		.filter((b: any) => b != null);
	if (filtered.length === 0) return null;
	if (filtered.length === 1) return filtered[0];
	return [op, ...filtered];
}

const snipProp = (sq: SearchQuery, propName: string): string => {
	assMatch(sq, SearchQuery);
	SearchQuery._init(sq);
	assMatch(propName, String);
	const tree2 = treeWithoutProp(sq.tree, propName);
	return tree2 != null ? unparse(Array.isArray(tree2) ? tree2 : [SearchQuery.AND, tree2]) : '';
};


/**
 * Set several options for a top-level prop, e.g. "vert:foo OR vert:bar"
 * @param {SearchQuery?} [sq] If set, this is combined via AND!
 * @param {String} propName
 * @param {String[]} propValues Must not be empty
 * @returns a NEW SearchQuery
 */
SearchQuery.setPropOr = (sq: SearchQuery | null | undefined, propName: string, propValues: string[]): SearchQuery => {	
	assMatch(propName, String, "searchquery.js "+propName+": "+propValues);
	assMatch(propValues, "String[]", "searchquery.js "+propName); // NB: Should we allow empty? No - ambiguous whether or(empty) should mean all or none
	assert(propValues.length, "searchquery.js - "+propName+" Cant OR over nothing "+propValues)
	// quote the values? HACK if they have a space
	let qpropValues = propValues.map(propValue => propValue.indexOf(" ") === -1? propValue : '"'+propValue+'"');
	// join by OR
	let qor = propName+":" + qpropValues.join(" OR "+propName+":");	

	// no need to merge into a bigger query? Then we're done :)
	if ( ! sq || ! sq.query) {
		return new SearchQuery(qor);
	}

	// AND merge...
	let newq = snipProp(sq, propName);
	newq = newq+" AND ("+qor+")";
	// HACK - trim ANDs??
	newq = newq.replace(/ AND +AND /g," AND ");
	if (newq.substr(0, 5) === " AND ") {
		newq = newq.substr(5);
	}
	if (newq.substr(newq.length-5, newq.length) === " AND ") {
		newq = newq.substr(0, newq.length - 5);
	}
	// done
	return new SearchQuery(newq.trim());
};


/**
 * Merge two queries with OR
 * @param {?String|SearchQuery} sq 
 * @returns a NEW SearchQuery
 */
SearchQuery.or = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null): SearchQuery | null => {
	return SearchQuery.op(sq1, sq2, SearchQuery.OR);
}


/**
 * 
 * @param {?string|SearchQuery} sq1 
 * @param {?string|SearchQuery} sq2 
 * @param {!string} op 
 * @returns {SearchQuery} Can be null if both inputs are null
 */
SearchQuery.op = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null, op: string): SearchQuery | null => {	
	// convert to class
	if (typeof(sq1)==='string') sq1 = new SearchQuery(sq1);
	if (typeof(sq2)==='string') sq2 = new SearchQuery(sq2);

	// HACK remove (works for simple cases)
	// NB: done before the null tests as this handles null differently to and/or 
	if (SearchQuery.REMOVE === op) {
		if ( ! sq2 || ! sq2.query) return sq1 || null;
		// null remove thing => null??
		if ( ! sq1 || ! sq1.query) return sq1 || null;
		// (assume AND) pop the 1st tree op, filter out nodes that appear in sq2
		let t2 = sq1.tree!.slice(1).filter(
			n1 => ! _.find(sq2!.tree!, n2 => _.eq(JSON.stringify(n1), JSON.stringify(n2)))
		);
		t2 = [sq1.tree![0]].concat(t2);
		let u = unparse(t2);
		// console.warn(sq1.tree, sq2.tree, t2, u);
		let newsq = new SearchQuery(u);
		return newsq;
	}

	// one is falsy? then just return the other
	if ( ! sq2) return sq1 || null;
	if ( ! sq1) return sq2 || null;
	if ( ! sq1.query) return sq2;
	if ( ! sq2.query) return sq1;

	// Same top-level op?
	if (op === sq1.tree![0] && op === sq2.tree![0]) {
		let newq = sq1.query+" "+op+" "+sq2.query;	
		return new SearchQuery(newq);
	}

	// CRUDE but it should work -- at least for simple cases
	let newq = bracket(sq1.query)+" "+op+" "+bracket(sq2.query);
	return new SearchQuery(newq);
};


/**
 * Add brackets if needed.
 * @param {!String} s 
 */
const bracket = (s: string): string => s.includes(" ")? "("+s+")" : s;


/**
 * Merge two queries with AND
 * @param {?String|SearchQuery} sq 
 * @returns {SearchQuery} a NEW SearchQuery
 */
SearchQuery.and = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null): SearchQuery | null => {
	return SearchQuery.op(sq1, sq2, SearchQuery.AND);
}


/**
 * Remove sq2 from sq1, e.g. remove("foo AND bar", "bar") -> "foo"
 * @param {?String|SearchQuery} sq1
 * @param {?String|SearchQuery} sq2
 * @returns {SearchQuery} a NEW SearchQuery
 */
SearchQuery.remove = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null): SearchQuery | null => {
	return SearchQuery.op(sq1, sq2, SearchQuery.REMOVE);
}


/**
 * @param {?SearchQuery} sq 
 * @returns {!string}
 */
SearchQuery.str = (sq: SearchQuery | null | undefined): string => sq? sq.query : '';


/**
 * Get the value for a key from a query string, or null if not present.
 */
SearchQuery.propFromString = (queryString: string, key: string): string | null => {
	return SearchQuery.prop(new SearchQuery(queryString || ''), key);
};


/**
 * Set or remove a key:value in a query string. Returns the new query string.
 * If value is null/undefined/empty, removes any existing key:value for that key.
 */
SearchQuery.setPropInString = (queryString: string, key: string, value?: string | boolean | null): string => {
	return SearchQuery.str(SearchQuery.setProp(queryString || '', key, value));
};

export const propFromString = SearchQuery.propFromString;
export const setPropInString = SearchQuery.setPropInString;

/**
 * Convert a parse tree back into a query string.
 * Wraps nested subexpressions in parens when they use a different operator.
 */
const unparse = (tree: any): string => {
	if (typeof tree === 'string') return tree;
	// key:value object
	if (typeof tree === 'object' && !Array.isArray(tree)) {
		const keys = Object.keys(tree);
		assert(keys.length === 1);
		return keys[0] + ':' + tree[keys[0]];
	}
	if (!Array.isArray(tree) || tree.length === 0) return '';
	if (tree.length === 1) return unparse(tree[0]);
	const op = tree[0];
	const bits = tree.slice(1).filter((b: any) => b != null);
	if (bits.length === 0) return '';
	if (bits.length === 1) return unparse(bits[0]);
	const ubits = bits.map((bit: any) => {
		const s = unparse(bit);
		// Wrap in parens if nested array with different op (so re-parse preserves structure)
		if (Array.isArray(bit) && bit.length > 1 && bit[0] !== op) {
			return '(' + s + ')';
		}
		return s;
	});
	return ubits.join(' ' + op + ' ');
};


export default SearchQuery;

export function searchQueryToSqlWhereClause(sq: SearchQuery): string {
	// use the parse tree to convert to SQL
	console.log('sq.tree', sq.tree);
	return searchQueryToSqlWhereClause2(sq.tree!);
}

/**
 * recursive 
 */
function searchQueryToSqlWhereClause2(tree: any[]): string {
	if (typeof(tree) === 'string') {
		return "'"+tree+"'";
	}
	if (tree.length === 1) {
		return tree[0];
	}
	let op = tree[0];
	if (typeof(op) === 'object') {
		const v = op[Object.keys(op)[1]];
		return op[Object.keys(op)[0]]+"="+searchQueryToSqlWhereClause2(v);
	}	
	let bits = tree.slice(1);
	let ubits = bits.map(searchQueryToSqlWhereClause2);
	return "("+ubits.join(" "+op+" ")+")";
}