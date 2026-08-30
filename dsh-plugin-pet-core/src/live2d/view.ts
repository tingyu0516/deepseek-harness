/** Device-to-view transform copied from the Cubism Web sample's LAppView. */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44'
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix'

const VIEW_SCALE = 1
const VIEW_LOGICAL_LEFT = -1
const VIEW_LOGICAL_RIGHT = 1
const VIEW_LOGICAL_MAX_LEFT = -2
const VIEW_LOGICAL_MAX_RIGHT = 2
const VIEW_LOGICAL_MAX_BOTTOM = -2
const VIEW_LOGICAL_MAX_TOP = 2

export class PetCubismView {
  public constructor() {
    this._deviceToScreen = new CubismMatrix44()
    this._viewMatrix = new CubismViewMatrix()
  }

  public initialize(width: number, height: number): void {
    const ratio = width / height
    const left = -ratio
    const right = ratio
    const bottom = VIEW_LOGICAL_LEFT
    const top = VIEW_LOGICAL_RIGHT
    this._viewMatrix.setScreenRect(left, right, bottom, top)
    this._viewMatrix.scale(VIEW_SCALE, VIEW_SCALE)
    this._deviceToScreen.loadIdentity()
    if (width > height) {
      const screenW = Math.abs(right - left)
      this._deviceToScreen.scaleRelative(screenW / width, -screenW / width)
    } else {
      const screenH = Math.abs(top - bottom)
      this._deviceToScreen.scaleRelative(screenH / height, -screenH / height)
    }
    this._deviceToScreen.translateRelative(-width * 0.5, -height * 0.5)
    this._viewMatrix.setMaxScale(2)
    this._viewMatrix.setMinScale(0.8)
    this._viewMatrix.setMaxScreenRect(
      VIEW_LOGICAL_MAX_LEFT,
      VIEW_LOGICAL_MAX_RIGHT,
      VIEW_LOGICAL_MAX_BOTTOM,
      VIEW_LOGICAL_MAX_TOP,
    )
  }

  public transformViewX(deviceX: number): number {
    return this._viewMatrix.invertTransformX(this._deviceToScreen.transformX(deviceX))
  }

  public transformViewY(deviceY: number): number {
    return this._viewMatrix.invertTransformY(this._deviceToScreen.transformY(deviceY))
  }

  public getViewMatrix(): CubismViewMatrix {
    return this._viewMatrix
  }

  private _deviceToScreen: CubismMatrix44
  private _viewMatrix: CubismViewMatrix
}
