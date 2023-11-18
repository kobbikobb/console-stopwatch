module.exports = {
  roots: ["src"],
  transform: {
    '^.+\\.[tj]s?$': ['ts-jest'],
},
  preset: 'ts-jest',
  testEnvironment: 'node',
};