"use strict";

module.exports = Object.freeze([
  {
    id: "named-reordered-third",
    source:
      "((first, second, third) => first)(third: 3|, 1, 2)\n",
    expectedLabel: "(first, second, third)",
    expectedActiveParameter: 2
  },
  {
    id: "named-mixed-first-positional",
    source:
      "((first, second, third) => first)(third: 3, 1|, 2)\n",
    expectedLabel: "(first, second, third)",
    expectedActiveParameter: 0
  },
  {
    id: "named-mixed-second-positional",
    source:
      "((first, second, third) => first)(third: 3, 1, 2|)\n",
    expectedLabel: "(first, second, third)",
    expectedActiveParameter: 1
  },
  {
    id: "named-grouped-positional-slot",
    source:
      "((first, second) => first)((created: 41)|, second: 2)\n",
    expectedLabel: "(first, second)",
    expectedActiveParameter: 0
  },
  {
    id: "named-utf16-crlf",
    source:
      'prefix: "😀"\r\n' +
      "((first, second, third) => first)(third: 3|, 1, 2)\r\n",
    expectedLabel: "(first, second, third)",
    expectedActiveParameter: 2,
    expectedPosition: [1, 42]
  }
]);
