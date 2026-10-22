#!/usr/bin/env python3
"""Static regression checks for the WAF/remediation wiring.

These checks do not replace a live HTTP/attack simulation; they prevent the
known configuration gaps from silently returning.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WafRemediationSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.remediation = (ROOT / "services/remediation/index.js").read_text()
        cls.compose = (ROOT / "docker-compose.yml").read_text()
        cls.nginx = (ROOT / "infra/waf/default.conf.template").read_text()
        cls.zones = (ROOT / "infra/waf/security-zones.conf.template").read_text()

    def test_waf_is_allowlisted_for_controlled_restart(self):
        self.assertIn("ALLOWED_SERVICES: api-paiement,auth,front,waf", self.compose)
        self.assertIn("const wafRestart = await restartService('waf')", self.remediation)
        self.assertIn("WAF_URL: http://waf:8080", self.compose)

    def test_blocked_ip_file_is_parsed_by_lines(self):
        self.assertIn(r"content.split(/\r?\n/)", self.remediation)
        self.assertIn(r"/^\s*deny\s+([0-9.]+);\s*$/", self.remediation)

    def test_rate_limit_action_matches_enforced_nginx_policies(self):
        self.assertIn("limitation Nginx déjà active", self.remediation)
        self.assertIn("zone=auth_rate burst=20", self.nginx)
        self.assertIn("zone=api_rate burst=40", self.nginx)
        self.assertIn("zone=web_rate burst=60", self.nginx)
        self.assertIn("zone=auth_rate:10m rate=10r/s", self.zones)
        self.assertIn("zone=api_rate:10m rate=20r/s", self.zones)
        self.assertIn("zone=web_rate:10m rate=5r/s", self.zones)

    def test_rate_limit_returns_429(self):
        self.assertGreaterEqual(self.nginx.count("limit_req_status 429;"), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
