@echo off
cd /d D:\Bilibili_User_Personality
node server/scripts/uidDiscoveryScrape.js >> server\data\scraper-logs\discovery.log 2>> server\data\scraper-logs\discovery-stderr.log
