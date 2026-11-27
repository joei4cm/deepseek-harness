// Capture sizes that describe one window capture.
namespace DeepSeek.Cua.Windows;

internal static class CaptureSize
{
    // The capture surface, the captured content and the window frame bounds all come from the same
    // window rectangle, and Windows 10 rounds them independently, so they can differ by a pixel or
    // two without the window having changed.
    internal const int TolerancePixels = 2;

    // Whether a captured size describes the same window as the observed bounds.
    internal static bool Matches(int captured, int expected)
        => Math.Abs(captured - expected) <= TolerancePixels;
}
