import { SemanticValidator as NewSemanticValidator } from '@pascal-app/layout-intelligence';
import type { LegacyPascalPayload } from './compiler';

export class SemanticValidator {
  private newValidator = new NewSemanticValidator();

  /**
   * Run semantic verification and correction on the compiled payload using the Layout Intelligence Engine.
   */
  public validate(payload: LegacyPascalPayload): LegacyPascalPayload {
    return this.newValidator.validate(payload as any) as any;
  }
}

