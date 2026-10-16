CREATE INDEX jobs_city_normalized_idx ON jobs (lower(city));
--> statement-breakpoint
CREATE INDEX jobs_region_normalized_idx ON jobs (country,lower(region));
--> statement-breakpoint
CREATE INDEX employers_industry_normalized_idx ON employers (lower(industry));
