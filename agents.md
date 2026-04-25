# Agent Instructions for cdkd

This project is optimized for Node.js 25+ and uses native TypeScript support via `--experimental-strip-types`.

## Standards and Conventions

- **Vanilla TypeScript Only**: Do not add any third-party dependencies.
- **Node.js 25 Features**: Leverage native TypeScript stripping. Do NOT use parameter properties in constructors.
- **Testing**: Use the native `node:test` runner.
- **Imports**: Use `.js` extensions in imports for compiled output compatibility.
- **System Dependencies**: Using system `zip` for asset packaging to keep the project dependency-free.
