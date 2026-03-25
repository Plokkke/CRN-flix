#!/usr/bin/env python3
"""
Create draft versions for all components and root after release
"""

import sys
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from common import (
    log_info, log_success, log_warning, log_error,
    get_available_components, get_component_version, set_component_version,
    get_root_version, set_root_version, create_draft_version,
    sync_version_manifests, commit_and_push_changes, Emoji
)

class DraftCreator:
    def __init__(self, create_branch: bool = False):
        self.create_branch = create_branch
        self.available_components = get_available_components()
        self.changes_made = []
    
    def create_root_draft(self) -> str:
        """Create draft version for root package"""
        current_version = get_root_version()
        draft_version = create_draft_version(current_version)
        
        log_info(f"Creating root draft version: {current_version} -> {draft_version}")
        
        if set_root_version(draft_version):
            log_success(f"Root draft version created: {draft_version}")
            self.changes_made.append("package.json")
            return draft_version
        else:
            log_error("Failed to create root draft version")
            sys.exit(1)
    
    def create_component_drafts(self):
        """Create draft versions for all components"""
        log_info("Creating draft versions for all components...")
        
        for component in self.available_components:
            current_version = get_component_version(component)
            draft_version = create_draft_version(current_version)
            
            log_info(f"Creating draft for {component}: {current_version} -> {draft_version}")
            
            if set_component_version(component, draft_version):
                log_success(f"Draft created for {component}: {draft_version}")
                self.changes_made.append(f"components/{component}/package.json")
            else:
                log_error(f"Failed to create draft for {component}")
                sys.exit(1)
    
    def create_draft_branch(self, draft_version: str) -> bool:
        """Create and switch to draft branch"""
        from common import run_command
        
        branch_name = f"{draft_version}"
        log_info(f"Creating draft branch: {branch_name}")
        
        # Create new branch
        exit_code, stdout, stderr = run_command(["git", "checkout", "-b", branch_name])
        
        if exit_code == 0:
            log_success(f"Draft branch created: {branch_name}")
            return True
        else:
            log_error(f"Failed to create draft branch: {stderr}")
            return False
    
    def finalize_drafts(self, draft_version: str):
        """Finalize draft creation with git operations"""
        # Sync version manifests
        sync_version_manifests()
        self.changes_made.extend([".github/versions.json", "terraform/versions.json"])
        
        # Create branch if requested
        if self.create_branch:
            if not self.create_draft_branch(draft_version):
                sys.exit(1)
        
        # Commit and push changes
        commit_message = f"chore({draft_version}): prepare for next development iteration"
        
        if commit_and_push_changes(commit_message, self.changes_made):
            log_success("Draft versions committed and pushed")
        else:
            log_error("Failed to commit draft versions")
            sys.exit(1)
    
    def print_draft_summary(self):
        """Print summary of draft creation"""
        print(f"\n{Emoji.ROCKET} Draft Creation Summary:")
        print(f"   Root version: {get_root_version()}")
        print(f"   Component versions:")
        
        for component in self.available_components:
            version = get_component_version(component)
            print(f"      {component}: {version}")
        
        print(f"   Files changed: {len(self.changes_made)}")
        print()

def main():
    # Parse command line arguments
    create_branch = False
    if len(sys.argv) > 1:
        create_branch = sys.argv[1].lower() in ['true', '1', 'yes']
    
    log_info("Creating draft versions for next development iteration...")
    log_info(f"Create branch: {create_branch}")
    
    # Create draft creator
    creator = DraftCreator(create_branch)
    
    # Create draft versions
    root_draft_version = creator.create_root_draft()
    creator.create_component_drafts()
    
    # Finalize with git operations
    creator.finalize_drafts(root_draft_version)
    
    # Print summary
    creator.print_draft_summary()
    
    log_success("Draft creation completed successfully")

if __name__ == "__main__":
    main()