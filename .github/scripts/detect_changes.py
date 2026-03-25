#!/usr/bin/env python3
"""
Detect changes in components for selective versioning
"""

import sys
import json
from typing import Dict, List
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from common import (
    log_info, log_success, log_error,
    list_changed_files, list_components, get_semantic_release_type,
    list_changed_components, detect_pattern_changes,
    write_github_outputs, Emoji
)

def detect_infra_changes(changed_files: List[str]) -> bool:
    """Detect changes in infrastructure files"""
    infra_patterns = [
        ".tf",
    ]
    
    return detect_pattern_changes(changed_files, infra_patterns, "infrastructure changes")

def detect_docs_changes(changed_files: List[str]) -> bool:
    """Detect changes in documentation files"""
    docs_patterns = [
        "docs/",
        ".md"
    ]
    
    return detect_pattern_changes(changed_files, docs_patterns, "documentation changes")

def analyze_changes(changed_files: List[str], is_release_mode: bool = False) -> Dict:
    """Analyze all types of changes"""
    log_info(f"Analyzing changes: {changed_files}")
    log_info(f"Total changed files: {len(changed_files)}")
    
    changed_components = list_changed_components(changed_files)
    has_infra_changes = detect_infra_changes(changed_files)
    has_docs_changes = detect_docs_changes(changed_files)
    
    return {
        'has_changes': len(changed_components) > 0 or has_infra_changes or has_docs_changes,
        'has_infra_changes': has_infra_changes,
        'has_docs_changes': has_docs_changes,
        'components': changed_components,
        'release_type': get_semantic_release_type() if is_release_mode else None,
    }
    
def print_summary(results: Dict):
    """Print analysis summary"""
    print(f"\n{Emoji.CHART} Change Detection Summary:")
    print(f"   Components changed: {', '.join(results['components']) or 'none'}")
    print(f"   Infrastructure changes: {results['has_infra_changes']}")
    print(f"   Documentation changes: {results['has_docs_changes']}")
    if results.get('release_type'):
        print(f"   Release type: {results['release_type']}")
    print()

def output_results(results: Dict):
    """Output results to GitHub Actions"""
    github_outputs = {}
    for key, value in results.items():
        if isinstance(value, list):
            github_outputs[key] = json.dumps(value)
        elif isinstance(value, bool):
            github_outputs[key] = str(value).lower()
        else:
            github_outputs[key] = str(value)
    
    write_github_outputs(github_outputs)

def main():
    """
    Usage:
    - detect_changes.py --force-all                    # Force validate all components
    - detect_changes.py base_sha head_sha               # Compare two SHAs 
    - detect_changes.py base_sha head_sha --release     # Compare two SHAs for release mode
    """
    if len(sys.argv) < 2:
        log_error("Usage: detect_changes.py [--force-all] | [base_sha head_sha [--release]]")
        sys.exit(1)

    if sys.argv[1] == '--force-all':
        results = {
            'has_changes': True,
            'has_infra_changes': True,
            'has_docs_changes': True,
            'components': list_components(),
        }
    else:
        if len(sys.argv) < 3:
            log_error("Need base_sha and head_sha arguments")
            sys.exit(1)
        
        base_sha = sys.argv[1]
        head_sha = sys.argv[2]
        is_release_mode = len(sys.argv) > 3 and sys.argv[3] == '--release'
        
        changed_files = list_changed_files(base_sha, head_sha)
        results = analyze_changes(changed_files, is_release_mode)
        print_summary(results)

    output_results(results)
    sys.exit(0)

if __name__ == "__main__":
    main()