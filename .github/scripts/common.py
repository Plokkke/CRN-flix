#!/usr/bin/env python3
"""
Common utilities for GitHub Actions scripts
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# Emojis for consistent output
class Emoji:
    INFO = "🔍"
    SUCCESS = "✅"
    WARNING = "⚠️"
    ERROR = "❌"
    PACKAGE = "📦"
    TAG = "🏷️"
    ROCKET = "🚀"
    CHART = "📊"

class Colors:
    BLUE = '\033[0;34m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    RED = '\033[0;31m'
    NC = '\033[0m'  # No Color

def log_info(message: str):
    """Log info message with emoji"""
    logger.info(f"{Colors.BLUE}{Emoji.INFO} {message}{Colors.NC}")

def log_success(message: str):
    """Log success message with emoji"""
    logger.info(f"{Colors.GREEN}{Emoji.SUCCESS} {message}{Colors.NC}")

def log_warning(message: str):
    """Log warning message with emoji"""
    logger.warning(f"{Colors.YELLOW}{Emoji.WARNING} {message}{Colors.NC}")

def log_error(message: str):
    """Log error message with emoji"""
    logger.error(f"{Colors.RED}{Emoji.ERROR} {message}{Colors.NC}")

def get_root_dir() -> Path:
    """Get the root directory of the project"""
    return Path(__file__).parent.parent.parent

def run_command(cmd: List[str], cwd: Optional[Path] = None, capture_output: bool = True, timeout: int = None) -> Tuple[int, str, str]:
    """
    Run a command and return exit code, stdout, stderr
    """
    if cwd is None:
        cwd = get_root_dir()
    
    # Dynamic timeout based on command type
    if timeout is None:
        if any(keyword in ' '.join(cmd) for keyword in ['build', 'install', 'push', 'semantic-release']):
            timeout = 300  # 5 minutes for build operations
        elif 'test' in ' '.join(cmd):
            timeout = 180  # 3 minutes for tests
        else:
            timeout = 60   # 1 minute for other operations
    
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=capture_output,
            text=True,
            timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        log_error(f"Command timed out after {timeout}s: {' '.join(cmd)}")
        return 1, "", f"Command timed out after {timeout}s"
    except subprocess.CalledProcessError as e:
        log_error(f"Command failed: {' '.join(cmd)}")
        return e.returncode, e.stdout, e.stderr
    except Exception as e:
        log_error(f"Unexpected error running command: {e}")
        return 1, "", str(e)

def run_command_with_retry(cmd: List[str], max_retries: int = 3, cwd: Optional[Path] = None, capture_output: bool = True, timeout: int = None) -> Tuple[int, str, str]:
    """
    Run a command with retry logic and exponential backoff
    """
    for attempt in range(max_retries):
        exit_code, stdout, stderr = run_command(cmd, cwd, capture_output, timeout)
        
        if exit_code == 0:
            return exit_code, stdout, stderr
        
        if attempt < max_retries - 1:
            wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
            log_warning(f"Command failed (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s...")
            time.sleep(wait_time)
        else:
            log_error(f"Command failed after {max_retries} attempts: {' '.join(cmd)}")
    
    return exit_code, stdout, stderr

def get_changed_files(last_tag: Optional[str] = None) -> List[str]:
    """Get list of changed files since last tag"""
    if last_tag:
        cmd = ["git", "diff", "--name-only", f"{last_tag}..HEAD"]
        log_info(f"Getting changes since tag: {last_tag}")
    else:
        cmd = ["git", "ls-files"]
        log_info("Getting all tracked files (no previous tag)")
    
    exit_code, stdout, stderr = run_command(cmd)
    
    if exit_code != 0:
        log_error(f"Failed to get changed files: {stderr}")
        sys.exit(1)
    
    files = [f.strip() for f in stdout.strip().split('\n') if f.strip()]
    log_info(f"Found {len(files)} changed files")
    return files

def list_components() -> List[str]:
    """Get list of components"""
    components_dir = get_root_dir() / "components"
    
    if not components_dir.exists():
        log_warning("Components directory not found")
        return []
    
    components = [
        d.name for d in components_dir.iterdir() 
        if d.is_dir() and (d / "package.json").exists()
    ]
    
    log_info(f"Found {len(components)} components: {', '.join(components)}")
    return components

def read_package_json(path: Path) -> Dict:
    """Read and parse package.json"""
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        log_error(f"package.json not found at {path}")
        return {}
    except json.JSONDecodeError as e:
        log_error(f"Invalid JSON in {path}: {e}")
        return {}

def write_package_json(path: Path, data: Dict) -> bool:
    """Write package.json with proper formatting"""
    try:
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')  # Add trailing newline
        return True
    except Exception as e:
        log_error(f"Failed to write {path}: {e}")
        return False

def get_component_version(component: str) -> str:
    """Get current version of a component"""
    package_path = get_root_dir() / "components" / component / "package.json"
    package_data = read_package_json(package_path)
    return package_data.get('version', '0.0.0')

def set_component_version(component: str, version: str) -> bool:
    """Set version of a component"""
    package_path = get_root_dir() / "components" / component / "package.json"
    package_data = read_package_json(package_path)
    
    if not package_data:
        return False
    
    package_data['version'] = version
    success = write_package_json(package_path, package_data)
    
    if success:
        log_success(f"Updated {component} to version {version}")
    else:
        log_error(f"Failed to update {component} version")
    
    return success

def get_root_version() -> str:
    """Get current root version"""
    package_path = get_root_dir() / "package.json"
    package_data = read_package_json(package_path)
    return package_data.get('version', '0.0.0')

def set_root_version(version: str) -> bool:
    """Set root version"""
    package_path = get_root_dir() / "package.json"
    package_data = read_package_json(package_path)
    
    if not package_data:
        return False
    
    package_data['version'] = version
    success = write_package_json(package_path, package_data)
    
    if success:
        log_success(f"Updated root to version {version}")
    else:
        log_error(f"Failed to update root version")
    
    return success

def get_last_release_tag() -> Optional[str]:
    """Get the last release tag"""
    exit_code, stdout, stderr = run_command(["git", "describe", "--tags", "--abbrev=0"])
    
    if exit_code == 0:
        tag = stdout.strip()
        log_info(f"Last release tag: {tag}")
        return tag
    else:
        log_warning("No previous release tag found")
        return None

def get_semantic_release_type() -> str:
    """
    Get release type from semantic-release dry run
    Returns: 'major', 'minor', 'patch', or 'none'
    """
    log_info("Analyzing commits for release type...")
    
    exit_code, stdout, stderr = run_command([
        "npx", "semantic-release", "--dry-run", "--no-ci"
    ])
    
    if exit_code != 0:
        log_warning(f"semantic-release failed: {stderr}")
        return "patch"  # Default fallback
    
    # Parse semantic-release output
    lines = stdout.split('\n')
    for line in lines:
        if "The next release version is" in line:
            # Extract version and compare with current
            current_version = get_root_version()
            if " major " in line.lower():
                return "major"
            elif " minor " in line.lower():
                return "minor"
            elif " patch " in line.lower():
                return "patch"
    
    # If no release needed
    if "There are no relevant changes" in stdout:
        return "none"
    
    return "patch"  # Default

def write_github_output(key: str, value: str):
    """Write output for GitHub Actions"""
    github_output = os.getenv('GITHUB_OUTPUT')
    if github_output:
        with open(github_output, 'a') as f:
            f.write(f"{key}={value}\n")

def write_github_outputs(outputs: Dict[str, str]):
    """Write multiple outputs for GitHub Actions"""
    for key, value in outputs.items():
        write_github_output(key, value)

def list_changed_files(base_sha: str, head_sha: str) -> List[str]:
    """Get files changed in PR between two commits"""
    if not base_sha or not head_sha:
        log_error("Missing base_sha or head_sha for PR comparison")
        return []
    
    log_info(f"Getting PR changes: {base_sha}..{head_sha}")
    
    exit_code, stdout, stderr = run_command([
        "git", "diff", "--name-only", f"{base_sha}..{head_sha}"
    ])
    
    if exit_code != 0:
        log_error(f"Failed to get PR changes: {stderr}")
        return []
    
    files = [f.strip() for f in stdout.strip().split('\n') if f.strip()]
    log_info(f"Found {len(files)} changed files in PR")
    return files

def list_changed_components(changed_files: List[str]) -> List[str]:
    """Detect which components have changes from a list of changed files"""
    components = list_components()
    
    changed_components = []
    for component in components:
        component_prefix = f"components/{component}/"
        if any(file.startswith(component_prefix) for file in changed_files):
            changed_components.append(component)
            log_success(f"Component {component} has changes")
    
    return changed_components

def detect_pattern_changes(changed_files: List[str], patterns: List[str], change_type: str = "changes") -> bool:
    """Detect if any files match the given patterns"""
    has_changes = any(
        any(file.startswith(pattern) or pattern in file for pattern in patterns)
        for file in changed_files
    )
    
    if has_changes:
        log_success(f"{change_type.capitalize()} detected")
        matching_files = [
            file for file in changed_files
            if any(file.startswith(pattern) or pattern in file for pattern in patterns)
        ]
        log_info(f"Matching files: {', '.join(matching_files)}")
    else:
        log_info(f"No {change_type} detected")
    
    return has_changes

def post_github_comment(pr_number: str, comment_body: str) -> bool:
    """Post comment to GitHub PR using gh CLI"""
    if not pr_number:
        log_error("No PR number provided")
        return False
    
    exit_code, stdout, stderr = run_command([
        "gh", "pr", "comment", pr_number,
        "--body", comment_body
    ])
    
    if exit_code == 0:
        log_success("GitHub comment posted successfully")
        return True
    else:
        log_error(f"Failed to post GitHub comment: {stderr}")
        return False

def increment_version(version: str, release_type: str) -> str:
    """
    Increment version based on release type
    """
    # Remove any pre-release suffix
    base_version = version.split('-')[0]
    major, minor, patch = map(int, base_version.split('.'))
    
    if release_type == "major":
        return f"{major + 1}.0.0"
    elif release_type == "minor":
        return f"{major}.{minor + 1}.0"
    elif release_type == "patch":
        return f"{major}.{minor}.{patch + 1}"
    else:
        return version

def create_draft_version(version: str) -> str:
    """
    Create a draft version by incrementing patch and adding -draft.0 suffix
    """
    # Remove any existing pre-release suffix
    base_version = version.split('-')[0]
    major, minor, patch = map(int, base_version.split('.'))
    
    # Increment patch for next iteration
    next_patch = patch + 1
    return f"{major}.{minor}.{next_patch}-draft.0"

def sync_version_manifests():
    """Sync version manifests using existing script"""
    log_info("Syncing version manifests...")
    
    exit_code, stdout, stderr = run_command([
        "node", "scripts/sync-versions.js"
    ])
    
    if exit_code == 0:
        log_success("Version manifests synced successfully")
    else:
        log_error(f"Failed to sync version manifests: {stderr}")
        sys.exit(1)

def commit_and_push_changes(message: str, files: List[str]):
    """Commit and push changes to git"""
    log_info(f"Committing changes: {message}")
    
    # Add files
    for file in files:
        run_command(["git", "add", file])
    
    # Commit
    exit_code, stdout, stderr = run_command([
        "git", "commit", "-m", message
    ])
    
    if exit_code != 0:
        log_warning("No changes to commit")
        return False
    
    # Push
    exit_code, stdout, stderr = run_command([
        "git", "push", "origin", "HEAD"
    ])
    
    if exit_code == 0:
        log_success("Changes pushed successfully")
        return True
    else:
        log_error(f"Failed to push changes: {stderr}")
        return False