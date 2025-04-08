export const COMMON_CSS = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    color: #333;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  }
  .container {
    background-color: #ffffff;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  h1 {
    color: #2c3e50;
    margin-bottom: 20px;
    font-size: 24px;
  }
  .button {
    display: inline-block;
    padding: 12px 24px;
    background-color: #3498db;
    color: white;
    text-decoration: none;
    border-radius: 4px;
    margin: 20px 0;
  }
  .status {
    padding: 8px 16px;
    border-radius: 4px;
    display: inline-block;
    font-weight: bold;
    margin: 10px 0;
  }
  .status-pending { background-color: #3498db; color: white; }
  .status-in-progress { background-color: #3498db; color: white; }
  .status-fulfilled { background-color: #2ecc71; color: white; }
  .status-rejected { background-color: #e74c3c; color: white; }
  .status-canceled { background-color: #94312d; color: white; }
  .status-missing { background-color: #94312d; color: white; }
  .footer {
    margin-top: 30px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    font-size: 14px;
    color: #666;
  }
`;
