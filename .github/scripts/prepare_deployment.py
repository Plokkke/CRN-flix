#!/usr/bin/env python3
"""
Prepare deployment configuration and parameters
"""

import sys
import json
import os
from typing import Dict, List
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from common import (
    log_info, log_success, log_warning,
    get_available_components, get_root_version,
    write_github_outputs, sync_version_manifests
)

class DeploymentPreparation:
    def __init__(self, input_version: str = None, input_components: str = None, input_environment: str = None):
        self.input_version = input_version
        self.input_components = input_components
        self.input_environment = input_environment or 'production'
        
    def determine_version(self) -> str:
        """Determine deployment version"""
        if self.input_version:
            log_info(f"Using specified version: {self.input_version}")
            return self.input_version
        else:
            version = get_root_version()
            log_info(f"Using current package.json version: {version}")
            return version
    
    def determine_components(self) -> List[str]:
        """Determine components to deploy"""
        if self.input_components:
            # Parse comma-separated input
            components = [c.strip() for c in self.input_components.split(',') if c.strip()]
            log_info(f"Using specified components: {components}")
            return components
        else:
            # Find all components with Dockerfiles
            available_components = get_available_components()
            deployable_components = []
            
            for component in available_components:
                dockerfile_path = Path(f"components/{component}/Dockerfile")
                if dockerfile_path.exists():
                    deployable_components.append(component)
                    log_info(f"Component {component} has Dockerfile - deployable")
                else:
                    log_warning(f"Component {component} has no Dockerfile - skipping")
            
            log_info(f"Auto-detected deployable components: {deployable_components}")
            return deployable_components
    
    def determine_environment(self) -> str:
        """Determine target environment"""
        log_info(f"Target environment: {self.input_environment}")
        return self.input_environment
    
    def configure_terraform_backend(self, environment: str) -> bool:
        """Configure Terraform backend based on environment"""
        if environment == 'local':
            log_info("Local environment - Terraform backend disabled")
            return False
        elif environment in ['staging', 'production']:
            log_info(f"{environment.capitalize()} environment - Terraform backend enabled")
            return True
        else:
            log_warning(f"Unknown environment {environment}, enabling backend by default")
            return True
    
    def prepare_deployment(self) -> Dict:
        """Prepare all deployment parameters"""
        log_info("Preparing deployment configuration...")
        
        # Determine all parameters
        version = self.determine_version()
        components = self.determine_components()
        environment = self.determine_environment()
        tf_backend = self.configure_terraform_backend(environment)
        
        # Generate version manifest
        log_info("Generating version manifest...")
        sync_version_manifests()
        
        deployment_config = {
            'version': version,
            'components': components,
            'environment': environment,
            'tf_backend': tf_backend
        }
        
        log_success("Deployment preparation completed")
        log_info(f"Configuration: {json.dumps(deployment_config, indent=2)}")
        
        return deployment_config
    
    def output_for_github_actions(self, config: Dict):
        """Output configuration for GitHub Actions"""
        outputs = {
            'version': config['version'],
            'components': json.dumps(config['components']),
            'environment': config['environment'],
            'tf-backend': str(config['tf_backend']).lower()
        }
        
        write_github_outputs(outputs)

def main():
    """
    Usage: prepare_deployment.py [version] [components] [environment]
    """
    # Parse command line arguments or environment variables
    input_version = sys.argv[1] if len(sys.argv) > 1 else os.getenv('INPUT_VERSION')
    input_components = sys.argv[2] if len(sys.argv) > 2 else os.getenv('INPUT_COMPONENTS')
    input_environment = sys.argv[3] if len(sys.argv) > 3 else os.getenv('INPUT_ENVIRONMENT', 'production')
    
    # Create deployment preparation handler
    prep = DeploymentPreparation(input_version, input_components, input_environment)
    
    # Prepare deployment
    config = prep.prepare_deployment()
    
    # Output for GitHub Actions
    prep.output_for_github_actions(config)
    
    # Print final configuration
    print(json.dumps(config, indent=2))

if __name__ == "__main__":
    main()