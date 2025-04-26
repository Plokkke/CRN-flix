export const COMMON_CSS = `
  /* Base styles */
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    color: #333;
    margin: 0;
    padding: 0;
    background-color: #f7f7f7;
  }
  
  .container {
    max-width: 600px;
    width: 600px;
    min-width: 600px;
    margin: 0 auto;
    background-color: #ffffff;
    box-shadow: 0 0 10px rgba(0,0,0,0.1);
  }
  
  /* Typography */
  h1 {
    color: #1e1e2a;
    margin-top: 0;
    font-size: 24px;
  }
  
  h2 {
    color: #1e1e2a;
    margin-top: 25px;
    font-size: 20px;
    border-bottom: 1px solid #eee;
    padding-bottom: 10px;
  }

  h3 {
    color: #1e1e2a;
    margin-top: 20px;
    font-size: 18px;
  }
  
  p {
    margin: 10px 0;
  }
  
  /* Header */
  .header {
    background-color: #1e1e2a;
    color: white;
    padding: 30px 20px;
    text-align: center;
  }
  
  .logo {
    font-size: 32px;
    font-weight: bold;
    margin-bottom: 10px;
  }
  
  .tagline {
    font-size: 16px;
    opacity: 0.9;
  }
  
  /* Content */
  .content {
    padding: 30px 20px;
  }
  
  /* Cards and sections */
  .card {
    background-color: #ffffff;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  
  .section {
    margin: 25px 0;
  }
  
  .section-highlight {
    background-color: #f0f7ff;
    padding: 20px;
    border-radius: 5px;
  }
  
  .section-info {
    background-color: #f5f5f5;
    border-left: 4px solid #1e1e2a;
    padding: 15px;
    margin: 20px 0;
  }
  
  /* Media items */
  .media-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    margin: 15px 0;
  }
  
  .media-item {
    width: 100px;
    text-align: center;
  }
  
  .media-poster {
    width: 100px;
    height: auto;
    border-radius: 5px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  }
  
  .media-title {
    margin-top: 8px;
    font-size: 14px;
    color: #333;
  }
  
  .media-card {
    display: flex;
    gap: 20px;
    background-color: #ffffff;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  
  .media-details {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  
  .media-year {
    font-size: 16px;
    color: #666;
    font-weight: normal;
  }
  
  .episode-info {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }
  
  .episode-label, .episode-number {
    background-color: #f0f0f0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 14px;
    color: #666;
  }
  
  /* Status indicators */
  .status {
    display: inline-block;
    padding: 5px 10px;
    border-radius: 3px;
    font-weight: bold;
    margin: 10px 0;
  }
  
  .status-pending { background-color: #ffd700; color: #000; }
  .status-in-progress { background-color: #1e90ff; color: #fff; }
  .status-fulfilled { background-color: #32cd32; color: #fff; }
  .status-rejected { background-color: #ff4444; color: #fff; }
  .status-canceled { background-color: #808080; color: #fff; }
  .status-missing { background-color: #ff8c00; color: #fff; }
  
  /* Buttons */
  .btn {
    display: inline-block;
    padding: 12px 25px;
    background-color: #e50914;
    color: white;
    text-decoration: none;
    border-radius: 5px;
    font-weight: bold;
    margin-top: 15px;
  }
  
  .btn-secondary {
    background-color: #1e1e2a;
  }
  
  /* Form elements */
  .form-group {
    margin-bottom: 20px;
    width: 100%;
  }
  
  label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    color: #2c3e50;
  }
  
  input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 16px;
    transition: all 0.2s;
    box-sizing: border-box;
    display: block;
  }
  
  input:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
  
  button {
    background-color: #3498db;
    color: white;
    padding: 12px 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    transition: background-color 0.2s;
    width: 100%;
  }
  
  button:hover {
    background-color: #2980b9;
  }
  
  /* Footer */
  .footer {
    background-color: #f5f5f5;
    padding: 20px;
    text-align: center;
    color: #777;
    font-size: 14px;
    margin-top: 30px;
    border-top: 1px solid #eee;
  }
  
  /* Utility classes */
  .text-center { text-align: center; }
  .text-left { text-align: left; }
  .text-right { text-align: right; }
  
  .mt-0 { margin-top: 0; }
  .mt-10 { margin-top: 10px; }
  .mt-20 { margin-top: 20px; }
  .mt-30 { margin-top: 30px; }
  
  .mb-0 { margin-bottom: 0; }
  .mb-10 { margin-bottom: 10px; }
  .mb-20 { margin-bottom: 20px; }
  .mb-30 { margin-bottom: 30px; }
  
  .p-0 { padding: 0; }
  .p-10 { padding: 10px; }
  .p-20 { padding: 20px; }
  .p-30 { padding: 30px; }
  
  /* Responsive */
  @media only screen and (max-width: 480px) {
    .container {
      width: 100%;
      min-width: auto;
    }
    
    .header {
      padding: 20px 15px;
    }
    
    .content {
      padding: 20px 15px;
    }
    
    .media-card {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    
    .media-title {
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    
    .episode-info {
      justify-content: center;
    }
  }
`;

// Common header component
export const getHeaderSection = (serviceName: string) => `
  <div class="header">
    <div class="logo">${serviceName}</div>
    <div class="tagline">Votre collection privée de films et séries</div>
  </div>
`;

// Common footer component
export const getFooterSection = () => `
  <div class="footer">
    <p>Ceci est un service privé. Merci de ne pas partager vos identifiants.</p>
  </div>
`;
