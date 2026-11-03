"use strict";

const BASELINE = [
  {
    id: "baseline-parser-recovery",
    invalid: "name\n)",
    valid: "name\nother",
    range: [1, 0, 1, 1]
  }
];

const FEATURES = [
  {
    id: "contextual-for-generic",
    invalid: "for(x in xs)\n{ x }\n",
    valid: "for(x in xs) { x }\n",
    range: [0, 6, 0, 8]
  },
  {
    id: "contextual-for-numeric",
    invalid: "for(i, 0, 3) { i\n",
    valid: "for(i, 0, 3) { i }\n"
  },
  {
    id: "contextual-for-stepped",
    invalid: "for(i, 5, 0, -2) { i\n",
    valid: "for(i, 5, 0, -2) { i }\n"
  },
  {
    id: "contextual-for-binder",
    invalid: "for(item in [1, 2]) { item\n",
    valid:
      "f: () => {\n" +
      "    item: 99\n" +
      "    for(item in [1, 2]) { item }\n" +
      "    item\n" +
      "}\n"
  },
  {
    id: "bitwise-operators",
    invalid: "value: 1 >>> 2\n",
    valid:
      "a: 12 & 10\nb: 12 | 10\n" +
      "c: 12 ~ 10\nd: ~0\n" +
      "e: 1 << 8\nf: 16 >> 2\n"
  },
  {
    id: "contextual-return-and-caret",
    invalid: "f: () => { return ( }\n",
    valid:
      "f: () => { return 1 }\n" +
      "g: () => { ^1 }\n"
  },
  {
    id: "range-and-inverted-range",
    invalid: "value: Range(0, 4\n",
    valid:
      "a: Range(0, 4)\n" +
      "b: Range(4, 0)\n" +
      "a.eachStep(2, i => { i })\n" +
      "b.each(i => { i })\n"
  }
];

const NAMED_ARGUMENTS = [
  {
    id: "named-duplicate-explicit-label",
    invalid:
      "f: (a, b) => a\n" +
      "f(a: 1, a: 2)\n",
    valid:
      "f: (a, b) => a\n" +
      "f(b: 2, a: 1)\n" +
      "f(b: 2, 1)\n" +
      "f(b: 2, ...[1])\n"
  },
  {
    id: "named-duplicate-array-label",
    invalid:
      "Array: (item) => item\n" +
      "[item: 1, item: 2]\n",
    valid:
      "Array: (item) => item\n" +
      "named: [item: 5]\n" +
      "grouped: [(createdByArray: 7)]\n"
  }
];

module.exports = { BASELINE, FEATURES, NAMED_ARGUMENTS };
