import { getLogger } from './logger.js';

export class CdkdError extends Error {
  public readonly code: string;
  public readonly cause?: Error;

  constructor(message: string, code: string, cause?: Error) {
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
  public readonly physicalId?: string;

  constructor(
    message: string,
    resourceType: string,
    logicalId: string,
    physicalId?: string,
    cause?: Error
  ) {
    super(message, 'PROVISIONING_ERROR', cause);
    this.resourceType = resourceType;
    this.logicalId = logicalId;
    this.physicalId = physicalId;
  }
}

export class DependencyError extends CdkdError {
  constructor(message: string, cause?: Error) {
    super(message, 'DEPENDENCY_ERROR', cause);
  }
}

export class SynthesisError extends CdkdError {
  constructor(message: string, cause?: Error) {
    super(message, 'SYNTHESIS_ERROR', cause);
  }
}

export class AssetError extends CdkdError {
  constructor(message: string, cause?: Error) {
    super(message, 'ASSET_ERROR', cause);
  }
}

export class StateError extends CdkdError {
  constructor(message: string, cause?: Error) {
    super(message, 'STATE_ERROR', cause);
  }
}

export class LockError extends CdkdError {
  constructor(message: string, cause?: Error) {
    super(message, 'LOCK_ERROR', cause);
  }
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
