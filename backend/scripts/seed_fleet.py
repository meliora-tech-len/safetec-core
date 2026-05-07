"""
Fleet seed script — reads Excel files from seed_data/ and inserts trucks/trailers.

Usage (from backend/):
    python scripts/seed_fleet.py

Excel files expected in scripts/seed_data/:
    FLEET_LIST_OBHI_TRUCKS_AND_TRAILORS_UPDATED.xlsx
    FLEET_LIST_OF_SAFETEC_TRUCKS_AND_TRAILORS_UPDATED.xlsx

Place the Excel files in seed_data/ before running.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Script body to be implemented once Excel column mapping is confirmed.
# Required columns (approximate): Fleet #, Make, Model, Registration, VIN,
#   Driver, Licence No., Licence Expiry, Finance Institution,
#   Trailer 1 Reg, Trailer 1 VIN, Trailer 2 Reg, Trailer 2 VIN

if __name__ == "__main__":
    print("seed_fleet.py: not yet implemented — place Excel files in seed_data/ first.")
