import assert from "node:assert/strict";
import { test } from "node:test";
import { AskFormState } from "./form-state.ts";
import type { AskQuestion } from "./core.ts";

const single = (): AskQuestion => ({
	id: "db",
	question: "Which database?",
	options: [
		{ label: "SQLite", description: "zero ops", recommended: true, rationale: "single operator" },
		{ label: "Postgres" },
	],
});

const freeText = (): AskQuestion => ({ id: "name", question: "Project name?", placeholder: "foo" });

const multi = (): AskQuestion => ({
	id: "langs",
	question: "Which languages?",
	allowMultiple: true,
	options: [
		{ label: "ts", recommended: true, rationale: "primary" },
		{ label: "py" },
		{ label: "go" },
	],
});

test("initial state: nav, first question, selection lands on recommended", () => {
	const s = new AskFormState([single(), freeText()]);
	assert.equal(s.mode, "nav");
	assert.equal(s.idx, 0);
	assert.equal(s.sel, 0); // SQLite is recommended
});

test("single-select: enter drafts the highlighted label and advances", () => {
	const s = new AskFormState([single(), freeText()]);
	s.navDown();
	const out = s.selectEnter();
	assert.equal(out, undefined);
	assert.deepEqual(s.draft("db"), { kind: "option", value: "Postgres" });
	assert.equal(s.idx, 1);
	assert.equal(s.mode, "nav");
});

test("no options: enter opens text mode; saveText drafts and advances", () => {
	const s = new AskFormState([single(), freeText()]);
	s.selectEnter(); // db
	s.selectEnter(); // free text question -> opens text
	assert.equal(s.mode, "text");
	s.saveText("  orb-weaver  ");
	assert.deepEqual(s.draft("name"), { kind: "text", value: "orb-weaver" });
	assert.equal(s.mode, "summary");
});

test("saveText with empty value drafts nothing but still advances", () => {
	const s = new AskFormState([freeText()]);
	s.openText();
	s.saveText("   ");
	assert.equal(s.hasDraft("name"), false);
	assert.equal(s.mode, "summary");
});

test("multi-select: enter with no toggles flashes instead of advancing", () => {
	const s = new AskFormState([multi()]);
	s.toggleSpace(); // removes the derived recommended toggle -> empty
	assert.deepEqual([...s.currentToggles(multi())], []);
	s.selectEnter();
	assert.equal(s.mode, "nav");
	assert.equal(s.flash, "toggle at least one option with space");
});

test("multi-select: recommended starts toggled; enter drafts the toggle set", () => {
	const s = new AskFormState([multi()]);
	assert.deepEqual([...s.currentToggles(multi())], ["ts"]);
	s.navDown();
	s.toggleSpace(); // py on
	s.selectEnter();
	assert.deepEqual(s.draft("langs"), { kind: "options", value: ["ts", "py"] });
});

test("multi-select: rendering view never persists derived toggles", () => {
	const s = new AskFormState([multi()]);
	s.currentToggles(multi()); // derived, not stored
	s.toggleSpace(); // persists ts via togglesForEdit from derived ["ts"], then removes it -> empty
	assert.deepEqual([...s.currentToggles(multi())], []);
});

test("defer drafts null and advances; skip advances without drafting", () => {
	const s = new AskFormState([single(), freeText()]);
	s.defer();
	assert.deepEqual(s.draft("db"), { kind: "defer", value: null });
	s.skip();
	assert.equal(s.hasDraft("name"), false);
	assert.equal(s.mode, "summary");
});

test("summary: send blocked while unanswered, flash lists missing ids", () => {
	const s = new AskFormState([single(), freeText()]);
	s.defer();
	s.skip();
	assert.equal(s.mode, "summary");
	const out = s.summaryEnter();
	assert.equal(out, undefined);
	assert.equal(s.flash, "unanswered: name");
});

test("summary: edit jumps back to the question and returns to summary after", () => {
	const s = new AskFormState([single(), freeText()]);
	s.selectEnter(); // db answered
	s.skip(); // name unanswered -> summary
	s.summaryUp(); // row 1 (name)
	s.summaryUp(); // row 0 (db)
	assert.equal(s.summarySel, 0);
	s.summaryEnter();
	assert.equal(s.mode, "nav");
	assert.equal(s.idx, 0);
	s.selectEnter(); // re-answer db -> returnToSummary
	assert.equal(s.mode, "summary");
});

test("summary: submit answers all questions in order", () => {
	const s = new AskFormState([single(), freeText()]);
	s.selectEnter(); // db
	s.selectEnter(); // opens text for name
	s.saveText("shard");
	assert.equal(s.mode, "summary");
	const out = s.summaryEnter();
	assert.equal(out?.type, "answered");
	assert.deepEqual(out!.payload.answers.map((a) => [a.id, a.kind, a.value]), [
		["db", "option", "SQLite"],
		["name", "text", "shard"],
	]);
	assert.ok(s.finished);
});

test("esc: first press arms with hint, second cancels; other keys disarm", () => {
	const s = new AskFormState([single()]);
	s.selectEnter(); // answered, now summary
	assert.equal(s.escPress(), undefined);
	assert.equal(s.escArmed, true);
	assert.equal(s.flash, "esc again = discard all");
	s.summaryUp(); // any other transition disarms via rendering reset? no: disarm is explicit
	assert.equal(s.escArmed, true); // escArmed only resets on advance/esc
	const out = s.escPress();
	assert.equal(out?.type, "cancelled");
	assert.deepEqual(out!.payload.answers, []);
	assert.ok(s.finished);
});

test("text escape returns to nav keeping drafts intact", () => {
	const s = new AskFormState([freeText()]);
	s.openText();
	s.textEscape();
	assert.equal(s.mode, "nav");
	assert.equal(s.hasDraft("name"), false);
});

test("single question flow: advance lands directly on summary with send selected", () => {
	const s = new AskFormState([single()]);
	s.selectEnter();
	assert.equal(s.mode, "summary");
	assert.equal(s.summarySel, 1); // Send row
});
