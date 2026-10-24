/**
 * Pure state machine for the ask_user TUI form. No pi imports here so it stays
 * unit-testable with plain `node --test`. The component in index.ts maps raw
 * key events to these transitions and renders from the exposed state.
 */

import type { AskAnswer, AskQuestion, AskResultPayload } from "./core.ts";

export type FormMode = "nav" | "text" | "summary";
export type Draft = { kind: "option" | "options" | "text" | "defer"; value: string | string[] | null };

export type FormOutcome =
	| { type: "answered"; payload: AskResultPayload }
	| { type: "cancelled"; payload: AskResultPayload };

function initialSelection(q: AskQuestion): number {
	const opts = q.options ?? [];
	const rec = opts.findIndex((o) => o.recommended);
	return rec >= 0 ? rec : 0;
}

export class AskFormState {
	readonly questions: AskQuestion[];

	mode: FormMode = "nav";
	idx = 0;
	sel: number;
	summarySel: number;
	flash = "";
	escArmed = false;
	finished: FormOutcome | null = null;

	private returnToSummary = false;
	private readonly drafts = new Map<string, Draft>();
	private readonly toggled = new Map<string, Set<string>>();

	constructor(questions: AskQuestion[]) {
		this.questions = questions;
		this.sel = initialSelection(questions[0]);
		this.summarySel = questions.length;
	}

	// ---------- read API (rendering) ----------

	currentQuestion(): AskQuestion {
		return this.questions[this.idx];
	}

	isMulti(): boolean {
		return this.currentQuestion().allowMultiple === true && (this.currentQuestion().options?.length ?? 0) > 0;
	}

	draft(id: string): Draft | undefined {
		return this.drafts.get(id);
	}

	hasDraft(id: string): boolean {
		return this.drafts.has(id);
	}

	/** Saved text draft (initial value for the text input), if any. */
	textDraft(id: string): string | null {
		const d = this.drafts.get(id);
		return d?.kind === "text" ? ((d.value as string) ?? "") : null;
	}

	/** Toggles for a multi-select question: saved draft first, else the recommended option. */
	deriveToggles(q: AskQuestion): Set<string> {
		const d = this.drafts.get(q.id);
		if (d?.kind === "options") return new Set(d.value as string[]);
		const set = new Set<string>();
		const rec = (q.options ?? []).find((o) => o.recommended);
		if (rec) set.add(rec.label);
		return set;
	}

	/** Read-only view for rendering (does not persist derived state). */
	currentToggles(q: AskQuestion): Set<string> {
		return this.toggled.get(q.id) ?? this.deriveToggles(q);
	}

	/** Persisting view for input handlers. */
	private togglesForEdit(q: AskQuestion): Set<string> {
		let set = this.toggled.get(q.id);
		if (!set) {
			set = this.deriveToggles(q);
			this.toggled.set(q.id, set);
		}
		return set;
	}

	unanswered(): AskQuestion[] {
		return this.questions.filter((q) => !this.drafts.has(q.id));
	}

	// ---------- transitions ----------

	private finish(payload: AskResultPayload): FormOutcome {
		if (!this.finished) {
			const out: FormOutcome = { type: payload.status, payload };
			this.finished = out;
		}
		return this.finished;
	}

	cancel(): FormOutcome {
		return this.finish({ status: "cancelled", answers: [] });
	}

	private advance(): void {
		this.flash = "";
		this.escArmed = false;
		if (this.returnToSummary) {
			this.returnToSummary = false;
			this.mode = "summary";
			return;
		}
		this.idx++;
		if (this.idx >= this.questions.length) {
			this.mode = "summary";
			this.summarySel = this.questions.length;
		} else {
			this.mode = "nav";
			this.sel = initialSelection(this.currentQuestion());
		}
	}

	// --- nav mode ---

	navUp(): void {
		const n = this.currentQuestion().options?.length ?? 0;
		if (n) this.sel = (this.sel - 1 + n) % n;
	}

	navDown(): void {
		const n = this.currentQuestion().options?.length ?? 0;
		if (n) this.sel = (this.sel + 1) % n;
	}

	/** space on a multi-select question: toggle the highlighted option. */
	toggleSpace(): void {
		const q = this.currentQuestion();
		const opts = q.options ?? [];
		if (q.allowMultiple !== true || opts.length === 0) return;
		const set = this.togglesForEdit(q);
		const label = opts[this.sel].label;
		if (set.has(label)) set.delete(label);
		else set.add(label);
	}

	/**
	 * enter in nav mode. Returns an outcome when the form completes, else undefined.
	 * (Flash message on invalid multi-submit is exposed via `flash`.)
	 */
	selectEnter(): FormOutcome | undefined {
		const q = this.currentQuestion();
		const opts = q.options ?? [];
		const multi = q.allowMultiple === true;
		if (opts.length === 0) {
			this.openText();
			return undefined;
		}
		if (multi) {
			const set = this.togglesForEdit(q);
			if (set.size === 0) {
				this.flash = "toggle at least one option with space";
				return undefined;
			}
			this.drafts.set(q.id, { kind: "options", value: [...set] });
			this.advance();
			return undefined;
		}
		this.drafts.set(q.id, { kind: "option", value: opts[this.sel].label });
		this.advance();
		return undefined;
	}

	openText(): void {
		this.mode = "text";
	}

	/** Saves a free-text answer (empty/whitespace saves nothing) and advances. */
	saveText(value: string): void {
		if (this.mode !== "text") return;
		const text = value.trim();
		if (text) this.drafts.set(this.currentQuestion().id, { kind: "text", value: text });
		this.advance();
	}

	defer(): void {
		this.drafts.set(this.currentQuestion().id, { kind: "defer", value: null });
		this.advance();
	}

	skip(): void {
		this.advance();
	}

	// --- text mode ---

	textEscape(): void {
		this.mode = "nav";
	}

	// --- any mode ---

	/**
	 * esc outside text mode. First press arms (flash hint), second cancels.
	 * Returns an outcome only when the form is cancelled.
	 */
	escPress(): FormOutcome | undefined {
		if (this.escArmed) return this.cancel();
		this.escArmed = true;
		this.flash = "esc again = discard all";
		return undefined;
	}

	// --- summary mode ---

	summaryUp(): void {
		const rows = this.questions.length + 1;
		this.summarySel = (this.summarySel - 1 + rows) % rows;
	}

	summaryDown(): void {
		const rows = this.questions.length + 1;
		this.summarySel = (this.summarySel + 1) % rows;
	}

	/**
	 * enter in summary mode. On the Send row: submits when everything is
	 * answered (else flashes the missing ids); on a question row: jumps back
	 * to nav with returnToSummary armed.
	 */
	summaryEnter(): FormOutcome | undefined {
		if (this.summarySel === this.questions.length) {
			const u = this.unanswered();
			if (u.length > 0) {
				this.flash = `unanswered: ${u.map((q) => q.id).join(", ")}`;
				return undefined;
			}
			return this.finish(this.buildPayload());
		}
		this.idx = this.summarySel;
		this.returnToSummary = true;
		this.sel = initialSelection(this.currentQuestion());
		this.mode = "nav";
		this.flash = "";
		return undefined;
	}

	private buildPayload(): AskResultPayload {
		const answers: AskAnswer[] = this.questions.map((q) => {
			const d = this.drafts.get(q.id)!;
			return { id: q.id, question: q.question, kind: d.kind, value: d.value };
		});
		return { status: "answered", answers };
	}
}
