/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 *
 * DSH local: canvas/GL/texture stub. The official sample subdelegate also
 * owns LAppView sprites and LAppLive2DManager; the pet viewer supplies those.
 */

import { LAppGlManager } from './lappglmanager';
import { LAppTextureManager } from './lapptexturemanager';

export class LAppSubdelegate {
  public constructor() {
    this._canvas = null;
    this._glManager = new LAppGlManager();
    this._textureManager = new LAppTextureManager();
    this._frameBuffer = null;
  }

  public initialize(canvas: HTMLCanvasElement): boolean {
    if (!this._glManager.initialize(canvas)) {
      return false;
    }
    this._canvas = canvas;
    this._textureManager.setGlManager(this._glManager);
    const gl = this._glManager.getGl();
    this._frameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  public release(): void {
    this._textureManager.release();
    this._glManager.release();
    this._canvas = null;
    this._frameBuffer = null;
  }

  public getCanvas(): HTMLCanvasElement {
    return this._canvas;
  }

  public getGlManager(): LAppGlManager {
    return this._glManager;
  }

  public getTextureManager(): LAppTextureManager {
    return this._textureManager;
  }

  public getFrameBuffer(): WebGLFramebuffer {
    return this._frameBuffer;
  }

  public getGl(): WebGLRenderingContext | WebGL2RenderingContext {
    return this._glManager.getGl();
  }

  private _canvas: HTMLCanvasElement;
  private _glManager: LAppGlManager;
  private _textureManager: LAppTextureManager;
  private _frameBuffer: WebGLFramebuffer;
}
