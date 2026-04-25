# Agent Instructions for cdkd

This project is optimized for Node.js 25+ and uses native TypeScript support.

## Standards and Conventions

- **Production Ready Code**: Aim for high-quality, maintainable, and robust code.
- **Dependencies**: Only the AWS SDK (`@aws-sdk/*`) is allowed as a production dependency. No other third-party dependencies should be added.
- **Node.js 25+**: Only Node.js versions 25 and above are supported. Leverage native TypeScript stripping.
- **Vanilla TypeScript**: Use native TypeScript features supported by Node.js. Do NOT use parameter properties in constructors as they are not supported by the native type stripper.
- **Testing**: Use the native `node:test` runner.
- **Imports**: Use `.js` extensions in imports for compiled output compatibility.
- **System Dependencies**: Using system `zip` for asset packaging to keep the project dependency-free.
