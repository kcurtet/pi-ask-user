import assert from "node:assert/strict";
import { test } from "node:test";
import {
	answerPreview,
	DEFER_INSTRUCTION,
	formatResultText,
	isCounterQuestion,
	validateQuestions,
	validateTitle,
	type AskQuestion,
	type AskResultPayload,
} from "./core.ts";

const q = (overrides: Partial<AskQuestion> = {}): AskQuestion => ({
	id: "q1",
	question: "Which database?",
	...overrides,
});

test("validateQuestions: minimal valid question", () => {
	assert.deepEqual(validateQuestions([q()]), []);
});

test("validateQuestions: empty or non-array input", () => {
	assert.equal(validateQuestions([]).length, 1);
	assert.equal(validateQuestions(undefined).length, 1);
});

test("validateQuestions: duplicate ids rejected", () => {
	const errors = validateQuestions([q(), q({ id: "q1", question: "otra" })]);
	assert.ok(errors.some((e) => e.includes("duplicate id")));
});

test("validateQuestions: too many questions rejected", () => {
	const many = Array.from({ length: 7 }, (_, i) => q({ id: `q${i}` }));
	assert.ok(validateQuestions(many).some((e) => e.includes("at most 6")));
});

test("validateTitle", () => {
	assert.equal(validateTitle("Questions"), null);
	assert.equal(validateTitle("x".repeat(81))?.includes("title too long"), true);
});

test("validateQuestions: single option rejected", () => {
	const errors = validateQuestions([q({ options: [{ label: "solo" }] })]);
	assert.ok(errors.some((e) => e.includes("at least 2")));
});

test("validateQuestions: two recommended rejected", () => {
	const errors = validateQuestions([
		q({
			options: [
				{ label: "a", recommended: true, rationale: "x" },
				{ label: "b", recommended: true, rationale: "y" },
			],
		}),
	]);
	assert.ok(errors.some((e) => e.includes("at most one option can be recommended")));
});

test("validateQuestions: recommended without rationale rejected", () => {
	const errors = validateQuestions([q({ options: [{ label: "a", recommended: true }, { label: "b" }] })]);
	assert.ok(errors.some((e) => e.includes("must carry a rationale")));
});

test("validateQuestions: duplicate labels rejected", () => {
	const errors = validateQuestions([q({ options: [{ label: "a" }, { label: "a" }] })]);
	assert.ok(errors.some((e) => e.includes("duplicate label")));
});

test("isCounterQuestion", () => {
	assert.equal(isCounterQuestion("what if traffic grows?"), true);
	assert.equal(isCounterQuestion("what if traffic grows? "), true);
	assert.equal(isCounterQuestion("use PostgreSQL"), false);
});

test("formatResultText: answered with all kinds", () => {
	const payload: AskResultPayload = {
		status: "answered",
		answers: [
			{ id: "db", question: "DB?", kind: "option", value: "PostgreSQL" },
			{ id: "notes", question: "Anything else?", kind: "text", value: "what if traffic grows 10x?" },
			{ id: "notes2", question: "Something?", kind: "text", value: "no question here" },
			{ id: "auth", question: "Auth?", kind: "defer", value: null },
		],
	};
	const text = formatResultText(payload);
	assert.ok(text.startsWith("status: answered"));
	assert.ok(text.includes('[option] db → PostgreSQL'));
	assert.ok(text.includes("counter-question"));
	assert.ok(text.includes('"no question here"'));
	assert.ok(text.includes(`[defer] auth → ${DEFER_INSTRUCTION}`));
});

test("formatResultText: cancelled", () => {
	const text = formatResultText({ status: "cancelled", answers: [] });
	assert.ok(text.startsWith("status: cancelled"));
	assert.ok(text.includes("Ask the remaining questions in plain chat"));
});

test("answerPreview", () => {
	assert.equal(answerPreview("option", "PostgreSQL"), "PostgreSQL");
	assert.equal(answerPreview("defer", null), "→ you decide");
	assert.equal(answerPreview("text", "x".repeat(60)), `✎ ${"x".repeat(47)}…`);
});
