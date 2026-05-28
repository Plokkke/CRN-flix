#!/usr/bin/env python3
"""
Handle validation summary and PR comments
"""

import sys
import json
import os
from typing import Dict, List
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from common import log_info, log_success, log_error, Emoji

class ValidationSummary:
    def __init__(self, job_results: Dict[str, str], change_data: Dict[str, str]):
        self.job_results = job_results
        self.change_data = change_data
        self.has_changes = change_data.get('has_changes', 'false') == 'true'
        
    def check_validation_results(self) -> bool:
        """Check all validation results and exit with appropriate code"""
        if not self.has_changes:
            log_success("No changes detected - validation skipped")
            return True
        
        log_info("Checking validation results...")
        all_passed = True
        
        # Check each job result
        job_checks = [
            ('Components', 'validate_components'),
            ('Infrastructure', 'validate_infrastructure'), 
        ]
        
        for job_name, job_key in job_checks:
            result = self.job_results.get(job_key, 'skipped')
            
            if result == 'success':
                log_success(f"{job_name}: passed")
            elif result == 'skipped':
                log_info(f"{job_name}: skipped")
            else:
                log_error(f"{job_name}: failed")
                all_passed = False
        
        if all_passed:
            log_success("All validations completed successfully")
        else:
            log_error("Some validations failed")
            
        return all_passed
    
    def create_pr_comment_body(self) -> str:
        """Create PR comment body"""
        components = json.loads(self.change_data.get('components', '[]'))
        infra_changed = self.change_data.get('has_infra_changes', 'false') == 'true'
        
        # Get results
        component_result = self.job_results.get('validate_components', 'skipped')
        infra_result = self.job_results.get('validate_infrastructure', 'skipped')  
        
        # Determine overall success
        all_success = all(
            result in ['success', 'skipped']
            for result in [component_result, infra_result]
        )
        
        emoji = "✅" if all_success else "❌"
        status = "passed" if all_success else "failed"
        
        # Build validation details
        validation_details = ""
        
        if components:
            validation_details += f"**Components:** {', '.join(components)} ({component_result})\n"
        
        if infra_changed:
            validation_details += f"**Infrastructure:** {infra_result}\n"
        
        # Status message
        if all_success:
            status_message = "🎉 All validation checks passed! This PR is ready for review."
        else:
            status_message = "⚠️  Some validation checks failed. Please review the logs and fix any issues."
        
        # Build final comment
        title_case = status.capitalize()
        body = f"## {emoji} Validation {title_case}\n\n{validation_details}\n{status_message}"
        
        return body
    
    def post_pr_comment(self, comment_body: str):
        """Post comment to PR using GitHub CLI"""
        from common import post_github_comment
        
        pr_number = os.getenv('GITHUB_PR_NUMBER') or os.getenv('GITHUB_EVENT_PULL_REQUEST_NUMBER')
        return post_github_comment(pr_number, comment_body)

def main():
    """
    Usage: validation_summary.py <job_results_json> <change_data_json> [--post-comment]
    """
    if len(sys.argv) < 3:
        log_error("Usage: validation_summary.py <job_results_json> <change_data_json> [--post-comment]")
        sys.exit(1)
    
    try:
        job_results = json.loads(sys.argv[1])
        change_data = json.loads(sys.argv[2])
        post_comment = len(sys.argv) > 3 and sys.argv[3] == '--post-comment'
    except json.JSONDecodeError as e:
        log_error(f"Invalid JSON input: {e}")
        sys.exit(1)
    
    # Create summary handler
    summary = ValidationSummary(job_results, change_data)
    
    # Check validation results
    all_passed = summary.check_validation_results()
    
    # Post PR comment if requested and it's a PR event
    if post_comment and os.getenv('GITHUB_EVENT_NAME') == 'pull_request':
        comment_body = summary.create_pr_comment_body()
        summary.post_pr_comment(comment_body)
    
    # Exit with appropriate code
    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    main()