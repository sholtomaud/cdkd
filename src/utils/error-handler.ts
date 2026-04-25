import { getLogger } from './logger.js';

export class CdkdError extends Error {
  public readonly code: string;
  public readonly cause: Error | undefined;

  constructor(message: string, code: string, cause: Error | undefined = undefined) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProvisioningError extends CdkdError {
  public readonly resourceType: string;
  public readonly logicalId: string;
  public readonly physicalId: string | undefined;

  constructor(
    message: string,
    resourceType: string,
    logicalId: string,
    physicalId: string | undefined = undefined,
    cause: Error | undefined = undefined
  ) {
    super(message, 'PROVISIONING_ERROR', cause);
    this.resourceType = resourceType;
    this.logicalId = logicalId;
    this.physicalId = physicalId;
  }
}

export class DependencyError extends CdkdError {
  constructor(message: string, cause: Error | undefined = undefined) {
    super(message, 'DEPENDENCY_ERROR', cause);
  }
}

export class SynthesisError extends CdkdError {
  constructor(message: string, cause: Error | undefined = undefined) {
    super(message, 'SYNTHESIS_ERROR', cause);
  }
}

export class AssetError extends CdkdError {
  constructor(message: string, cause: Error | undefined = undefined) {
    super(message, 'ASSET_ERROR', cause);
  }
}

export class StateError extends CdkdError {
  constructor(message: string, cause: Error | undefined = undefined) {
    super(message, 'STATE_ERROR', cause);
  }
}

export class LockError extends CdkdError {
  constructor(message: string, cause: Error | undefined = undefined) {
    super(message, 'LOCK_ERROR', cause);
  }
}

export class ConfigError extends CdkdError {
  constructor(message: string, cause: Error | undefined = undefined) {
    super(message, 'CONFIG_ERROR', cause);
  }
}

export function isCdkdError(error: any): error is CdkdError {
  return error instanceof CdkdError;
}

export function formatError(error: any): string {
  if (error instanceof CdkdError) {
    let msg = `[${error.code}] ${error.message}`;
    if (error.cause) msg += ` (Cause: ${error.cause.message})`;
    return msg;
  }
  return error instanceof Error ? error.message : String(error);
}

export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const logger = getLogger();
      if (error instanceof CdkdError) {
        logger.error(`${error.message}`);
        if (error.cause) {
          logger.debug(`Cause: ${error.cause.message}`);
          if (error.cause.stack) {
            logger.debug(error.cause.stack);
          }
        }
      } else if (error instanceof Error) {
        logger.error(`Unexpected error: ${error.message}`);
        logger.debug(error.stack || 'No stack trace available');
      } else {
        logger.error(`Unexpected error: ${String(error)}`);
      }
      process.exit(1);
    }
  };
}
