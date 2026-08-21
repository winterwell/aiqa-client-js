// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

import Span from "./Span";
import Metric from "./Metric.js";
import type EmbeddingMeta from "./EmbeddingMeta.js";

/**
 * An Example aka an Eval
 */
export default interface Example {
	id: string;
	/* If created from spans */
	trace?: string;
	dataset: string;
	organisation: string;
	name?: string;
	notes?: string;
	/** Client-set tags for the Example */
	tags?: string[];
	 /** Client-set annotations for the Example (for things more complex than a tag) */
	 annotations?: Record<string, any>;
	/** blank if input is used 
	 * spans is a way to provide the input for running this example,
	 * by copying from a trace. This is convenient for creating real examples
	 * from actual usage. Example.spans is not for tracing, and the spans are stripped
	 * down to name, id, input, and tree-structure (parent)
	*/
	spans?: any[]; // Note: generate-schema.js fails if this is Span[]
	/** Blank if spans are used. Alternative to Spans */
	input?: any;
	/** example target good/bad outputs for similarity judgement. 
	*/
	outputs?: {
		good: any;
		bad: any;
	};
	/** Can be blank - only needed for per-example tests, e.g. "llm:this answer should be a joke about cats" */
	metrics?: Metric[];
	/**
	 * Primary cached embedding (default slot). Stored padded in ES; omitted from default GET /example responses.
	 */
	embedding_1?: number[];
	embeddingMeta_1?: EmbeddingMeta;
	/** Secondary embedding slot for a different model/setup. Omitted from default GET responses. */
	embedding_2?: number[];
	embeddingMeta_2?: EmbeddingMeta;
	created: Date;
	updated: Date;
}