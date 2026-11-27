<!--
状态：草稿，未发布。
用途：Discussion #14399 的回复正文，供作者过目后决定是否发布。
说明：改动位于 fork 的 `fix/cua-windows-capture-content-size` 分支，未向上游开 PR（上游不接受外部 PR）。
核对基线：上游 master（4b399c39a6）。
-->

# English reply

Your diagnosis is right, and that strict comparison is the wrong invariant. `GraphicsCaptureItem.Size` is the size of the capture target that sizes the frame pool surface, while `Direct3D11CaptureFrame.ContentSize` is the size of the content the compositor drew. Windows 10 rounds the two from the same window rectangle differently, so requiring equality rejects every frame of an unchanged window.

A branch on our fork, `fix/cua-windows-capture-content-size`, changes the helper in three ways:

- The captured content size and the capture surface size no longer have to be equal. A difference of up to two pixels is accepted; an empty content size is still refused.
- The comparison between the captured image size and the observed window bounds uses the same two-pixel tolerance. A window that really changed size or display scale is still reported as `WINDOW_CHANGED`, through the exact comparison of the window bounds and DPI taken before and after the capture.
- The `WINDOW_CHANGED` message now names both sizes, so a capture that is still rejected can be diagnosed from the error itself.

The delivered image still covers the capture surface, as before, and the shared coordinate layer scales image pixels to the window bounds. If your windows report a difference larger than two pixels, the message now carries the captured size and the window bounds, which is the number needed to widen the tolerance.

The helper cross-compiles here and the portable native checks pass; the capture path itself needs an acceptance run on Windows 10 22H2, which this environment cannot provide.

# 中文对照

您的定位是对的，而那条严格比较本身就是错误的不变量。`GraphicsCaptureItem.Size` 是捕获目标尺寸，用于确定帧池表面大小；`Direct3D11CaptureFrame.ContentSize` 是合成器实际绘制的内容尺寸。Windows 10 用不同的取整方式从同一个窗口矩形得到两者，因此要求二者相等，会把未变化的窗口的每一帧都判为尺寸变化。

fork 上的分支 `fix/cua-windows-capture-content-size` 对 helper 做了三处改动：

- 捕获内容尺寸与捕获表面尺寸不再要求相等，相差不超过两个像素即被接受；内容尺寸为空仍然拒绝。
- 捕获图像尺寸与观测到的窗口边界的比较使用同样的两像素容差。窗口确实改变尺寸或显示缩放时仍会报 `WINDOW_CHANGED`，依据是捕获前后窗口边界与 DPI 的精确比较。
- `WINDOW_CHANGED` 的消息现在同时给出两侧尺寸，被拒绝的捕获可以直接从错误里诊断。

交付的图像仍然覆盖捕获表面，与之前一致，共享坐标层会把图像像素缩放到窗口边界。如果您的窗口报告的差异大于两个像素，现在的消息会给出捕获尺寸与窗口边界，这是放宽容差所需的数字。

helper 在此环境可以交叉编译，便携的原生检查通过；捕获路径本身需要在 Windows 10 22H2 上做一次验收，本环境无法提供。
