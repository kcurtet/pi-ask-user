/**
 * Pure logic for the ask_user tool: input validation and result formatting.
 * No pi imports here so it stays unit-testable with plain `node --test`.
 */

export interface QuestionOption {
	label: string;
	description?: string;
	recommended?: boolean;
	rationale?: string;
}

export interface AskQuestion {
	id: string;
	question: string;
	context?: string;
	options?: QuestionOption[];
	allowMultiple?: boolean;
	placeholder?: string;
}

export type AnswerKind = "option" | "options" | "text" | "defer";

export type AskAnswer = {
	id: string;
	question: string;
	kind: AnswerKind;
	value: string | string[] | null;
};

export type AskResultPayload = {
	status: "answered" | "cancelled";
	answers: AskAnswer[];
};

const LIMITS = {
	questions: 6,
	title: 80,
	question: 300,
	context: 400,
	optionsPerQuestion: 6,
	label: 80,
	description: 200,
	rationale: 300,
} as const;

/** Instruction embedded in the tool result for every deferred question. */
export const DEFER_INSTRUCTION =
	"user deferred this decision to you: explain the trade-offs and ask what they still need in order to decide; only if it stays unresolved, pick the most technically sound option yourself and mark it `recommended, not confirmed` in the plan.";

export function validateQuestions(questions: unknown): string[] {
	const errors: string[] = [];
	if (!Array.isArray(questions) || questions.length === 0) {
		return ["at least one question is required"];
	}
	if (questions.length > LIMITS.questions) {
		errors.push(`at most ${LIMITS.questions} questions per call (got ${questions.length})`);
	}
	const ids = new Set<string>();
	for (const [i, q] of (questions as AskQuestion[]).entries()) {
		const at = `question[${i}]`;
		if (!q || typeof q !== "object") {
			errors.push(`${at}: not an object`);
			continue;
		}
		if (typeof q.id !== "string" || !q.id.trim()) {
			errors.push(`${at}: id is required`);
		} else if (ids.has(q.id)) {
			errors.push(`${at}: duplicate id "${q.id}"`);
		} else {
			ids.add(q.id);
		}
		if (typeof q.question !== "string" || !q.question.trim()) {
			errors.push(`${at}: question text is required`);
		} else if (q.question.length > LIMITS.question) {
			errors.push(`${at}: question too long (max ${LIMITS.question} chars)`);
		}
		if (q.context !== undefined && q.context.length > LIMITS.context) {
			errors.push(`${at}: context too long (max ${LIMITS.context} chars)`);
		}
		const opts = q.options;
		if (opts !== undefined) {
			if (!Array.isArray(opts) || opts.length < 2) {
				errors.push(`${at}: options must have at least 2 entries`);
			} else if (opts.length > LIMITS.optionsPerQuestion) {
				errors.push(`${at}: at most ${LIMITS.optionsPerQuestion} options`);
			} else {
				const labels = new Set<string>();
				const recommended = opts.filter((o) => o?.recommended);
				if (recommended.length > 1) {
					errors.push(`${at}: at most one option can be recommended`);
				}
				for (const o of recommended) {
					if (!o.rationale?.trim()) {
						errors.push(`${at}: recommended option "${o.label}" must carry a rationale`);
					}
				}
				for (const [j, o] of opts.entries()) {
					const oat = `${at}.options[${j}]`;
					if (typeof o?.label !== "string" || !o.label.trim()) {
						errors.push(`${oat}: label is required`);
					} else {
						if (labels.has(o.label)) errors.push(`${oat}: duplicate label "${o.label}"`);
						labels.add(o.label);
						if (o.label.length > LIMITS.label) errors.push(`${oat}: label too long (max ${LIMITS.label} chars)`);
					}
					if (o?.description && o.description.length > LIMITS.description) {
						errors.push(`${oat}: description too long (max ${LIMITS.description} chars)`);
					}
					if (o?.rationale && o.rationale.length > LIMITS.rationale) {
						errors.push(`${oat}: rationale too long (max ${LIMITS.rationale} chars)`);
					}
				}
			}
		}
	}
	return errors;
}

export function validateTitle(title: string): string | null {
	return title.length > LIMITS.title ? `title too long (max ${LIMITS.title} chars)` : null;
}

export function isCounterQuestion(text: string): boolean {
	return /\?\s*$/.test(text.trim());
}

export function formatResultText(payload: AskResultPayload): string {
	if (payload.status === "cancelled") {
		const n = payload.answers.length;
		const discarded = n > 0 ? ` (${n} drafted answer${n === 1 ? "" : "s"} discarded)` : "";
		return `status: cancelled — the user dismissed the form${discarded}. Ask the remaining questions in plain chat.`;
	}
	const lines = ["status: answered"];
	for (const [i, a] of payload.answers.entries()) {
		const n = `${i + 1}.`;
		if (a.kind === "option") {
			lines.push(`${n} [option] ${a.id} → ${a.value}`);
		} else if (a.kind === "options") {
			lines.push(`${n} [options] ${a.id} → ${(a.value as string[]).join(", ")}`);
		} else if (a.kind === "text") {
			const note = isCounterQuestion((a.value as string) ?? "") ? " (counter-question from the user — answer it before using this answer)" : "";
			lines.push(`${n} [text] ${a.id} → "${a.value}"${note}`);
		} else {
			lines.push(`${n} [defer] ${a.id} → ${DEFER_INSTRUCTION}`);
		}
	}
	return lines.join("\n");
}

/** Short human-facing preview of a draft answer, for the summary screen. */
export function answerPreview(kind: AnswerKind, value: string | string[] | null, max = 48): string {
	switch (kind) {
		case "option":
			return truncatePlain((value as string) ?? "", max);
		case "options":
			return truncatePlain((value as string[]).join(", "), max);
		case "text":
			return `✎ ${truncatePlain((value as string) ?? "", max)}`;
		case "defer":
			return "→ you decide";
	}
}

function truncatePlain(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
