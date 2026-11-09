import 'package:flutter/material.dart';

class BarkPalette {
  static const emerald = Color(0xFF00A86B);
  static const blue = Color(0xFF1B365D);
  static const ink = Color(0xFF1B365D);
  static const canvas = Color(0xFFF3F7F6);
  static const muted = Color(0xFF64716F);
}

class BarkTheme {
  static ThemeData get light {
    final colors = ColorScheme.fromSeed(
      seedColor: BarkPalette.emerald,
      primary: BarkPalette.emerald,
      secondary: BarkPalette.blue,
    );
    return ThemeData(
      colorScheme: colors,
      scaffoldBackgroundColor: BarkPalette.canvas,
      useMaterial3: true,
    );
  }
}
