from pathlib import Path
import re
import unittest


class TierPillStyleTests(unittest.TestCase):
    def test_tier_pill_uses_theme_foreground_color(self):
        stylesheet = Path('stylesheet.css').read_text()
        match = re.search(r'\.codex-pill\s*\{(?P<body>[^}]*)\}', stylesheet, re.DOTALL)
        self.assertIsNotNone(match)
        self.assertRegex(match.group('body'), r'\bcolor:\s*inherit\s*;')


if __name__ == '__main__':
    unittest.main()
