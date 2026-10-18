/**
 * ask_user — interactive question form for the TUI.
 *
 * The agent calls the tool with structured questions while preparing a plan.
 * A sequential form renders in the interactive area: per question the user can
 * pick an option (Enter), type free text (e), defer the decision (r), or skip
 * (Tab). A summary screen lets the user edit any answer before submitting.
 * Results return to the model as a structured tool result.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	answerPreview,
	formatResultText,
	validateQuestions,
	validateTitle,
	type AskAnswer,
	type AskQuestion,
	type AskResultPayload,
} from "./core.ts";

type Draft = { kind: "option" | "text" | "defer"; value: string | null };

const NAV_HELP = "↑↓ move · enter select · e type · r you decide · tab skip · esc cancel";
const TEXT_HELP = "enter save · esc back";
const SUMMARY_HELP = "↑↓ move · enter edit / send · esc cancel";

function simpleComponent(lines: string[]) {
	return {
		render(width: number) {
			return lines.map((l) => truncateToWidth(l, Math.max(8, width)));
		},
		invalidate() {},
	};
}

function initialSelection(q: AskQuestion): number {
	const opts = q.options ?? [];
	const rec = opts.findIndex((o) => o.recommended);
	return rec >= 0 ? rec : 0;
}

async function runAskForm(
	ctx: ExtensionContext,
	title: string,
	questions: AskQuestion[],
	signal: AbortSignal | undefined,
): Promise<AskResultPayload> {
	return await ctx.ui.custom<AskResultPayload>((tui, theme, _kb, done) => {
		let finished = false;
		const finish = (payload: AskResultPayload) => {
			if (finished) return;
			finished = true;
			done(payload);
		};

		let idx = 0;
		let mode: "nav" | "text" | "summary" = "nav";
		let returnToSummary = false;
		let sel = initialSelection(questions[0]);
		let summarySel = questions.length; // rows 0..n-1 = questions, n = Send
		let escArmed = false;
		let flash = "";
		const drafts = new Map<string, Draft>();

		const newInput = (q: AskQuestion): Input => {
			const d = drafts.get(q.id);
			const i = new Input({ placeholder: q.placeholder ?? "your answer…" });
			if (d?.kind === "text") i.setValue(d.value ?? "");
			i.onSubmit = (value: string) => {
				const text = value.trim();
				if (text) drafts.set(q.id, { kind: "text", value: text });
				i.focused = false;
				advance();
			};
			i.onEscape = () => {
				mode = "nav";
				i.focused = false;
			};
			return i;
		};

		let input = newInput(questions[0]);

		signal?.addEventListener("abort", () => finish({ status: "cancelled", answers: [] }), { once: true });

		function currentQuestion(): AskQuestion {
			return questions[idx];
		}

		function advance(): void {
			flash = "";
			escArmed = false;
			if (returnToSummary) {
				returnToSummary = false;
				mode = "summary";
				return;
			}
			idx++;
			if (idx >= questions.length) {
				mode = "summary";
				summarySel = questions.length;
			} else {
				mode = "nav";
				sel = initialSelection(currentQuestion());
			}
		}

		function openText(): void {
			input = newInput(currentQuestion());
			input.focused = true;
			mode = "text";
		}

		function unanswered(): AskQuestion[] {
			return questions.filter((q) => !drafts.has(q.id));
		}

		function submit(): void {
			const answers: AskAnswer[] = questions.map((q) => {
				const d = drafts.get(q.id)!;
				return { id: q.id, question: q.question, kind: d.kind, value: d.value };
			});
			finish({ status: "answered", answers });
		}

		// ---------- rendering ----------

		function styledWrapped(text: string, width: number, style: (l: string) => string): string[] {
			return wrapTextWithAnsi(text, width).map(style);
		}

		function clip(text: string, w: number): string {
			return truncateToWidth(text, Math.max(8, w));
		}

		function renderQuestionHeader(w: number, lines: string[]): void {
			const q = currentQuestion();
			lines.push(theme.fg("dim", clip(`Question ${idx + 1}/${questions.length} — ${title}`, w)));
			lines.push(...styledWrapped(q.question, w, (l) => theme.fg("accent", theme.bold(l))));
			if (q.context) lines.push(...styledWrapped(q.context, w, (l) => theme.fg("muted", l)));
			lines.push("");
		}

		function renderNav(w: number): string[] {
			const lines: string[] = [];
			renderQuestionHeader(w, lines);
			const q = currentQuestion();
			const opts = q.options ?? [];
			for (const [j, o] of opts.entries()) {
				const marker = j === sel ? "❯ " : "  ";
				const star = o.recommended ? " ★" : "";
				const line = clip(`${marker}${o.label}${star}`, w);
				lines.push(j === sel ? theme.fg("accent", theme.bold(line)) : line);
				if (j === sel && o.description) {
					lines.push(...styledWrapped(o.description, Math.max(8, w - 4), (l) => theme.fg("muted", `    ${l}`)));
				}
				if (o.recommended && o.rationale) {
					lines.push(...styledWrapped(`★ ${o.rationale}`, Math.max(8, w - 4), (l) => theme.fg("muted", `    ${l}`)));
				}
			}
			if (opts.length === 0) {
				lines.push(theme.fg("muted", clip("  free text — press e to type", w)));
			}
			const d = drafts.get(q.id);
			if (d) lines.push("", theme.fg("dim", clip(`saved: ${answerPreview(d.kind, d.value)}`, w)));
			lines.push("");
			lines.push(theme.fg("dim", clip(NAV_HELP, w)));
			if (flash) lines.push(theme.fg("warning", clip(flash, w)));
			return lines;
		}

		function renderText(w: number): string[] {
			const lines: string[] = [];
			renderQuestionHeader(w, lines);
			lines.push(...input.render(w));
			lines.push("");
			lines.push(theme.fg("dim", clip(TEXT_HELP, w)));
			return lines;
		}

		function renderSummary(w: number): string[] {
			const lines: string[] = [];
			lines.push(theme.fg("accent", theme.bold(`Summary — ${questions.length} question${questions.length === 1 ? "" : "s"}`)));
			lines.push("");
			for (const [i, q] of questions.entries()) {
				const d = drafts.get(q.id);
				const ans = d ? answerPreview(d.kind, d.value) : "(unanswered)";
				const row = `${i === summarySel ? "❯ " : "  "}${truncateToWidth(`${q.id}: ${ans}`, Math.max(10, w - 2))}`;
				if (!d) lines.push(theme.fg("warning", row));
				else if (i === summarySel) lines.push(theme.fg("accent", row));
				else lines.push(row);
			}
			const u = unanswered();
			const ready = u.length === 0;
			const sendRow = `${summarySel === questions.length ? "❯ " : "  "}▶ Send`;
			lines.push("");
			lines.push(ready ? theme.fg("success", theme.bold(sendRow)) : theme.fg("dim", sendRow));
			lines.push("");
			lines.push(theme.fg("dim", clip(SUMMARY_HELP, w)));
			if (flash) lines.push(theme.fg("warning", clip(flash, w)));
			else if (!ready) lines.push(theme.fg("warning", clip(`missing: ${u.map((q) => q.id).join(", ")}`, w)));
			return lines;
		}

		// ---------- input ----------

		const component = {
			render(width: number): string[] {
				if (mode === "text") return renderText(width);
				if (mode === "summary") return renderSummary(width);
				return renderNav(width);
			},
			invalidate() {},
			handleInput(data: string) {
				flash = "";
				if (mode === "text") {
					input.handleInput(data);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.escape)) {
					if (escArmed) {
						finish({ status: "cancelled", answers: [] });
						return;
					}
					escArmed = true;
					flash = "esc again = discard all";
					tui.requestRender();
					return;
				}
				escArmed = false;
				if (mode === "nav") {
					const opts = currentQuestion().options ?? [];
					if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
						if (opts.length) sel = (sel - 1 + opts.length) % opts.length;
					} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
						if (opts.length) sel = (sel + 1) % opts.length;
					} else if (matchesKey(data, Key.enter)) {
						if (opts.length) {
							drafts.set(currentQuestion().id, { kind: "option", value: opts[sel].label });
							advance();
						} else {
							openText();
						}
					} else if (matchesKey(data, "e")) {
						openText();
					} else if (matchesKey(data, "r")) {
						drafts.set(currentQuestion().id, { kind: "defer", value: null });
						advance();
					} else if (matchesKey(data, Key.tab)) {
						advance();
					}
				} else if (mode === "summary") {
					const rows = questions.length + 1;
					if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
						summarySel = (summarySel - 1 + rows) % rows;
					} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
						summarySel = (summarySel + 1) % rows;
					} else if (matchesKey(data, Key.enter)) {
						if (summarySel === questions.length) {
							if (unanswered().length > 0) {
								flash = `unanswered: ${unanswered().map((q) => q.id).join(", ")}`;
							} else {
								submit();
								return;
							}
						} else {
							idx = summarySel;
							returnToSummary = true;
							sel = initialSelection(currentQuestion());
							mode = "nav";
						}
					}
				}
				tui.requestRender();
			},
		};
		return component;
	});
}

// ---------- tool definition ----------

const parameters = Type.Object({
	title: Type.Optional(Type.String({ description: "Short form title shown in the header (default: 'Questions')" })),
	questions: Type.Array(
		Type.Object({
			id: Type.String({ description: "Short stable snake_case id" }),
			question: Type.String({ description: "One-line question" }),
			context: Type.Optional(Type.String({ description: "1-2 lines: why this matters / constraints" })),
			options: Type.Optional(
				Type.Array(
					Type.Object({
						label: Type.String({ description: "Short option label" }),
						description: Type.Optional(Type.String({ description: "One-line trade-off, shown when selected" })),
						recommended: Type.Optional(Type.Boolean({ description: "Mark the single technically strongest option" })),
						rationale: Type.Optional(Type.String({ description: "Why recommended — required when recommended" })),
					}),
					{ description: "2-6 choices; omit for free-text-only questions" },
				),
			),
			placeholder: Type.Optional(Type.String({ description: "Hint for the free-text input" })),
		}),
		{ description: "1-6 questions, unique ids; keep text short, long context goes in chat before calling" },
	),
});

const outputSchema = Type.Object({
	status: Type.Union([Type.Literal("answered"), Type.Literal("cancelled")]),
	answers: Type.Array(
		Type.Object({
			id: Type.String(),
			question: Type.String(),
			kind: Type.Union([Type.Literal("option"), Type.Literal("text"), Type.Literal("defer")]),
			value: Type.Union([Type.String(), Type.Null()]),
		}),
	),
});

const askUserTool = defineTool({
	name: "ask_user",
	label: "Ask user",
	description: `Interactive question form for the user, shown in the terminal UI. Use while preparing a plan or whenever the answer changes the approach. The user picks an option, types free text (including counter-questions), or defers a decision to you. Put long context in the chat BEFORE calling — keep form text short (question ≤ 1 line, context ≤ 2 lines). Mark recommended on the single technically strongest option only with a real technical basis, always with a short rationale; for pure preference calls mark none. Deferred decisions come back with instructions: help the user decide (explain trade-offs, ask what they need), and only if unresolved choose yourself and mark it "recommended, not confirmed" in the plan. Interactive TUI only; in other modes ask in chat.`,
	promptSnippet: "ask_user — interactive question form for plan and decision input",
	parameters,
	outputSchema,
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
		if (ctx.mode !== "tui") {
			return {
				content: [{ type: "text", text: "ask_user requires the interactive TUI. Ask the questions in plain chat instead." }],
				isError: true,
			};
		}
		const questions = params.questions as AskQuestion[];
		const title = params.title ?? "Questions";
		const titleError = validateTitle(title);
		if (titleError) {
			return {
				content: [{ type: "text", text: `Invalid ask_user arguments:\n- ${titleError}` }],
				isError: true,
			};
		}
		const errors = validateQuestions(questions);
		if (errors.length > 0) {
			return {
				content: [{ type: "text", text: `Invalid ask_user arguments:\n- ${errors.join("\n- ")}` }],
				isError: true,
			};
		}
		const payload = await runAskForm(ctx, title, questions, signal);
		if (signal?.aborted) {
			return {
				content: [{ type: "text", text: formatResultText({ status: "cancelled", answers: [] }) }],
				structuredContent: { status: "cancelled", answers: [] },
				details: { status: "cancelled", answers: [] },
			};
		}
		return {
			content: [{ type: "text", text: formatResultText(payload) }],
			structuredContent: payload,
			details: payload,
		};
	},
	renderCall: (args, theme: Theme) =>
		simpleComponent([
			theme.fg("accent", `❓ ${args.questions.length} question(s)${args.title ? ` — ${args.title}` : ""}`),
		]),
	renderResult: (result, _options, theme: Theme) => {
		const p = result.details as AskResultPayload | undefined;
		if (!p) return simpleComponent([theme.fg("dim", "ask_user")]);
		if (p.status === "cancelled") {
			return simpleComponent([theme.fg("error", "✗ cancelled by user")]);
		}
		const answered = p.answers.filter((a) => a.kind !== "defer").length;
		const deferred = p.answers.length - answered;
		const lines = [
			theme.fg("success", theme.bold(`✓ answered ${answered} · you decide ${deferred}`)),
			...p.answers.map((a) => theme.fg("muted", `  ${a.id}: ${answerPreview(a.kind, a.value, 60)}`)),
		];
		return simpleComponent(lines);
	},
});

export default function (pi: ExtensionAPI): void {
	pi.registerTool(askUserTool);
}
