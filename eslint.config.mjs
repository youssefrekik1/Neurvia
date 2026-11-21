import next from "eslint-config-next/core-web-vitals";
export default [
  ...next,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
    },
  },
];
