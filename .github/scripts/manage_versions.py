#!/usr/bin/env python3
"""
Manage selective versioning based on component changes
"""

import sys
import json
from typing import Dict, List, Set
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from common import (
    log_info, log_success, log_warning, log_error,
    get_available_components, get_component_version, set_component_version,
    get_root_version, set_root_version, increment_version,
    sync_version_manifests, Emoji
)

class VersionManager:
    def __init__(self, changed_components: List[str], release_type: str, has_component_changes: bool):
        self.changed_components = set(changed_components)
        self.release_type = release_type
        self.has_component_changes = has_component_changes
        self.available_components = get_available_components()
        self.version_history = self._load_version_history()
    
    def _load_version_history(self) -> Dict[str, str]:
        """Load version history to get previous stable versions"""
        history = {}
        
        # Read from terraform/versions.json if it exists
        versions_file = Path(__file__).parent.parent.parent / "terraform" / "versions.json"
        if versions_file.exists():
            try:
                with open(versions_file, 'r') as f:
                    data = json.load(f)
                    components = data.get('components', {})
                    
                    # Extract stable versions (non-draft)
                    for component, version in components.items():
                        if '-draft' not in version:
                            history[component] = version
                        else:
                            # For draft versions, extract the base version
                            base_version = version.split('-')[0]
                            # Decrement patch to get previous stable
                            parts = base_version.split('.')
                            if len(parts) == 3:
                                major, minor, patch = map(int, parts)
                                if patch > 0:
                                    history[component] = f"{major}.{minor}.{patch-1}"
                                else:
                                    history[component] = f"{major}.{minor}.0"
            except Exception as e:
                log_warning(f"Could not load version history: {e}")
        
        return history
    
    def _get_previous_stable_version(self, component: str) -> str:
        """Get the previous stable version for a component"""
        if component in self.version_history:
            return self.version_history[component]
        else:
            # Default to 1.0.0 if no history
            log_warning(f"No version history for {component}, defaulting to 1.0.0")
            return "1.0.0"
    
    def _rollback_draft_version(self, component: str) -> bool:
        """Rollback a component from draft to previous stable version"""
        current_version = get_component_version(component)
        
        if '-draft' in current_version:
            # Get previous stable version
            previous_stable = self._get_previous_stable_version(component)
            log_info(f"Rolling back {component} from {current_version} to {previous_stable}")
            return set_component_version(component, previous_stable)
        else:
            log_info(f"Component {component} is not in draft, keeping version {current_version}")
            return True
    
    def _apply_release_version(self, component: str, new_version: str) -> bool:
        """Apply new release version to a component"""
        current_version = get_component_version(component)
        log_info(f"Updating {component} from {current_version} to {new_version}")
        return set_component_version(component, new_version)
    
    def process_component_versions(self, new_root_version: str) -> bool:
        """Process versions for all components based on change detection"""
        success = True
        
        log_info(f"Processing component versions (release type: {self.release_type})")
        
        if self.has_component_changes:
            log_info("Component changes detected - applying selective versioning")
            
            for component in self.available_components:
                if component in self.changed_components:
                    # Component has changes - apply new version
                    log_success(f"Component {component} has changes, applying version {new_root_version}")
                    if not self._apply_release_version(component, new_root_version):
                        success = False
                else:
                    # Component unchanged - rollback draft to previous stable
                    log_info(f"Component {component} unchanged, rolling back draft")
                    if not self._rollback_draft_version(component):
                        success = False
        else:
            log_info("No component changes - rolling back all components to stable versions")
            
            # No component changes - rollback all components
            for component in self.available_components:
                if not self._rollback_draft_version(component):
                    success = False
        
        return success
    
    def process_root_version(self) -> str:
        """Process root version and return new version"""
        current_root_version = get_root_version()
        
        if self.release_type == 'none':
            log_info("No release needed, keeping current root version")
            return current_root_version
        
        # Calculate new root version
        new_root_version = increment_version(current_root_version, self.release_type)
        
        log_info(f"Updating root version from {current_root_version} to {new_root_version}")
        
        if set_root_version(new_root_version):
            log_success(f"Root version updated to {new_root_version}")
            return new_root_version
        else:
            log_error("Failed to update root version")
            sys.exit(1)
    
    def print_version_summary(self):
        """Print summary of version changes"""
        print(f"\n{Emoji.PACKAGE} Version Management Summary:")
        print(f"   Release type: {self.release_type}")
        print(f"   Component changes: {self.has_component_changes}")
        print(f"   Changed components: {', '.join(self.changed_components) if self.changed_components else 'none'}")
        print(f"   Root version: {get_root_version()}")
        print()
        
        print("   Component versions:")
        for component in self.available_components:
            version = get_component_version(component)
            status = "📝 changed" if component in self.changed_components else "📋 unchanged"
            print(f"      {component}: {version} {status}")
        print()

def main():
    # Parse command line arguments
    if len(sys.argv) < 4:
        log_error("Usage: manage_versions.py <changed_components_json> <release_type> <has_component_changes>")
        sys.exit(1)
    
    try:
        changed_components = json.loads(sys.argv[1])
        release_type = sys.argv[2]
        has_component_changes = sys.argv[3].lower() == 'true'
    except (json.JSONDecodeError, IndexError) as e:
        log_error(f"Invalid arguments: {e}")
        sys.exit(1)
    
    # Validate release type
    if release_type not in ['major', 'minor', 'patch', 'none']:
        log_error(f"Invalid release type: {release_type}")
        sys.exit(1)
    
    log_info(f"Managing versions for release type: {release_type}")
    log_info(f"Changed components: {changed_components}")
    log_info(f"Has component changes: {has_component_changes}")
    
    # Create version manager
    manager = VersionManager(changed_components, release_type, has_component_changes)
    
    # Process versions
    if release_type != 'none':
        # Update root version first
        new_root_version = manager.process_root_version()
        
        # Process component versions
        if not manager.process_component_versions(new_root_version):
            log_error("Failed to process some component versions")
            sys.exit(1)
        
        # Sync version manifests
        sync_version_manifests()
        
        log_success("Version management completed successfully")
    else:
        log_info("No release needed, skipping version updates")
    
    # Print summary
    manager.print_version_summary()

if __name__ == "__main__":
    main()