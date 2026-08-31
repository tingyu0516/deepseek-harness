/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 *
 * DSH local: audio is not played in the pet window.
 */

import { IParameterProvider } from '@framework/motion/iparameterprovider';

export class LAppWavFileHandler extends IParameterProvider {
  public start(_filePath: string): boolean {
    return false;
  }

  public override update(_deltaTimeSeconds?: number): boolean {
    return false;
  }

  public override getParameter(): number {
    return 0;
  }

  public getRms(): number {
    return 0;
  }

  public release(): void {}
}
