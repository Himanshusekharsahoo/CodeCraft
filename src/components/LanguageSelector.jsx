"use client";
import {
  Box,
  Button,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Text,
} from "@chakra-ui/react";
import { LANGUAGE_VERSIONS } from "../constants";
import { Langar } from "next/font/google";
import { color } from "framer-motion";
const languages = Object.entries(LANGUAGE_VERSIONS);
const active_color = "blue.400";
const LanguageSelector = ({ language, onSelect }) => {
  return (
    <Box className="flex items-center flex-shrink-0">
      <span className="mr-1 text-xs text-slate-400 font-mono hidden lg:inline">Lang:</span>
      <MenuRoot isLazy>
        <MenuTrigger asChild>
          <Button variant="unstyled" size="sm" className="text-xs font-mono text-indigo-300 hover:text-white px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08]">
            {language}
          </Button>
        </MenuTrigger>
        <MenuContent  className="absolute top-12 z-10">
          {languages.map(([lang, version]) => (
            <MenuItem
              key={lang}
              onClick={() => onSelect(lang)}
              color={lang === language ? active_color : ""}
              bg={lang === language ? "gray.900" : "transparent"}
              _hover={{
                color: active_color,
                bg: "gray.900",
              }}
            >
              {lang}
              &nbsp;
              <Text as="span" color="gray.600" fontSize="sm">
                {version}
              </Text>
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
    </Box>
  );
};

export default LanguageSelector;
