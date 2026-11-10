import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.repin_e2 import EXPECTED_CONTRACT_SHA256, RepinError, sha256, verify_contract_hash


class RepinContractPinTests(unittest.TestCase):
    def test_current_shared_contract_matches_the_pin(self):
        contract = (ROOT / "docs/GRIDIRON-CONTRACT-v1.md").read_bytes()
        self.assertEqual(sha256(contract), EXPECTED_CONTRACT_SHA256)
        self.assertEqual(verify_contract_hash(contract), EXPECTED_CONTRACT_SHA256)

    def test_contract_drift_is_rejected(self):
        contract = (ROOT / "docs/GRIDIRON-CONTRACT-v1.md").read_bytes() + b"\n"
        with self.assertRaisesRegex(RepinError, "CONTRACT DRIFT"):
            verify_contract_hash(contract)


if __name__ == "__main__":
    unittest.main()
