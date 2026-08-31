/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

/**
 * Cubism SDKのサンプルで使用するWebGLを管理するクラス
 */
export class LAppGlManager {
  public constructor() {
    this._gl = null;
  }

  public initialize(canvas: HTMLCanvasElement): boolean {
    // DSH local: try WebGL2 then WebGL1; never alert() in a pet window.
    this._gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!this._gl) {
      this._gl = null;
      return false;
    }
    return true;
  }

  /**
   * 解放する。
   */
  public release(): void {}

  public getGl(): WebGLRenderingContext | WebGL2RenderingContext {
    return this._gl;
  }

  private _gl: WebGLRenderingContext | WebGL2RenderingContext = null;
}
