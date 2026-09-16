module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        canvas: "#F5F6F0",
        ink: "#192D25",
        muted: "#59685F",
        forest: "#235C3D",
        line: "#DFE6DD",
      },
    },
  },
  plugins: [],
};
