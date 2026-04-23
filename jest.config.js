export default {
  transform: {
    "^.+\\.[tj]sx?$": "babel-jest",  // Use babel-jest to transpile all JavaScript/TypeScript files
  },
  testEnvironment: "node",  // Node environment for testing
};
