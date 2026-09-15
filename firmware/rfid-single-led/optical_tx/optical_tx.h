#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OPTICAL_VERSION 1
#define OPTICAL_MAX_PAYLOAD 64
#define OPTICAL_PREAMBLE_LEN 16

typedef struct {
    uint8_t version;
    uint16_t station_id;
    uint16_t sequence;
    uint8_t message_type;
    uint8_t length;
    uint8_t payload[OPTICAL_MAX_PAYLOAD];
} optical_frame_t;

/* Encode logical frame into OOK symbols. Returns symbol count. */
size_t optical_encode(const optical_frame_t *frame, uint8_t *symbols, size_t cap);

/* Blocking transmit. Owns the LED until complete. */
bool optical_transmit(const optical_frame_t *frame);

#ifdef __cplusplus
}
#endif
