CREATE TABLE `outages` (
	`id` integer PRIMARY KEY NOT NULL,
	`list` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`supplier_name` text NOT NULL,
	`gln` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`cause` text,
	`comment` text,
	`customers` integer,
	`start_ms` integer,
	`end_ms` integer,
	`expected_end_ms` integer,
	`postcodes` text NOT NULL,
	`lat` real,
	`lng` real,
	`radius_m` integer,
	`hash` text NOT NULL,
	`first_seen_ms` integer NOT NULL,
	`gone_ms` integer,
	FOREIGN KEY (`gln`) REFERENCES `grid_companies`(`gln`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "outages_list" CHECK("outages"."list" in ('active', 'planned')),
	CONSTRAINT "outages_kind" CHECK("outages"."kind" in ('unplanned', 'announced', 'planned', 'notice'))
);
--> statement-breakpoint
CREATE INDEX `outages_open` ON `outages` (`gone_ms`,`list`);--> statement-breakpoint
CREATE INDEX `outages_gln` ON `outages` (`gln`);