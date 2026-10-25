declare module 'robots-parser' {
  type RobotsRules = {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
  };
  export default function robotsParser(robotsUrl: string, content: string): RobotsRules;
}
